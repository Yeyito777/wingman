// Fall = an impact over ~2.5 g followed by stillness. Pure and clock-injected so it can be unit-tested with
// synthetic accelerometer traces (tests/fall.test.ts).

export interface FallDetectorConfig {
  impactG: number;
  /** ignore the bounce right after the impact */
  settleMs: number;
  /** stillness needed after the impact to confirm */
  confirmMs: number;
  /** deviation from 1 g that counts as movement while confirming */
  stillTolerance: number;
}

export const DEFAULT_FALL: FallDetectorConfig = { impactG: 2.5, settleMs: 700, confirmMs: 10_000, stillTolerance: 0.25 };

export type FallEvent = { kind: "fall"; peakG: number; at: number } | { kind: "move"; at: number };

export function createFallDetector(cfg: Partial<FallDetectorConfig> = {}) {
  const c = { ...DEFAULT_FALL, ...cfg };
  let impactAt = 0;
  let peak = 0;
  let judgeFrom = 0;
  let lastMove = 0;
  return {
    config: c,
    setConfirmMs(ms: number) {
      c.confirmMs = ms;
    },
    /** feed one sample: x/y/z in g; returns events to report */
    push(x: number, y: number, z: number, t: number): FallEvent[] {
      const g = Math.sqrt(x * x + y * y + z * z);
      const dev = Math.abs(g - 1);
      const out: FallEvent[] = [];
      if (dev > 0.18 && t - lastMove > 5000) {
        lastMove = t;
        out.push({ kind: "move", at: t });
      }
      if (g >= c.impactG) {
        if (!impactAt || t - impactAt > 1500) peak = 0;
        impactAt = t;
        judgeFrom = t + c.settleMs;
        peak = Math.max(peak, g);
        return out;
      }
      if (impactAt && t >= judgeFrom) {
        if (dev > c.stillTolerance) {
          impactAt = 0;
          return out;
        }
        if (t - judgeFrom >= c.confirmMs) {
          out.push({ kind: "fall", peakG: Math.round(peak * 10) / 10, at: t });
          impactAt = 0;
        }
      }
      return out;
    },
  };
}
