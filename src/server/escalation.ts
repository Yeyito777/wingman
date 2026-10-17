// Pure escalation state machine: (state, event) -> (state, effects).
// L0 monitoring -> L1 buddies -> L2 bystander mode -> L3 emergency contact.
// A buddy acknowledgement pauses the ladder; a coherent check-in, the PIN, or a buddy resolves it.

import type { RiskAssessment, Stage, Timers } from "../shared/types.ts";

export interface EscState {
  stage: Stage;
  stageSince: number;
  /** when the ladder climbs next (null at L0 and L3) */
  nextAt: number | null;
  acks: { name: string; at: number }[];
  /** last suspicion-triggered check-in */
  lastProbeAt: number | null;
}

export type EscEvent =
  | { type: "risk"; now: number; risk: RiskAssessment }
  | { type: "tick"; now: number }
  | { type: "ack"; now: number; by: string }
  | { type: "escalate"; now: number; by: string }
  | { type: "resolve"; now: number; by: string; how: string };

export type Effect =
  | { type: "probe"; reason: string }
  | { type: "alertBuddies"; trigger: string }
  | { type: "bystander" }
  | { type: "notifyContact" }
  | { type: "paused"; by: string; until: number }
  | { type: "resolved"; by: string; how: string; fromStage: Stage };

export function initialEscalation(now: number): EscState {
  return { stage: 0, stageSince: now, nextAt: null, acks: [], lastProbeAt: null };
}

export function step(s: EscState, e: EscEvent, t: Timers): { state: EscState; effects: Effect[] } {
  switch (e.type) {
    case "risk": {
      if (s.stage === 0 && e.risk.level === "alert") {
        return enter(s, 1, e.now, t, [{ type: "alertBuddies", trigger: e.risk.summary }, { type: "probe", reason: "alert" }]);
      }
      if (s.stage === 0 && e.risk.level === "watch") {
        if (s.lastProbeAt === null || e.now - s.lastProbeAt >= t.probeCooldownMs) {
          const top = e.risk.reasons[0]?.code ?? "default";
          return { state: { ...s, lastProbeAt: e.now }, effects: [{ type: "probe", reason: top }] };
        }
      }
      return { state: s, effects: [] };
    }
    case "tick": {
      if ((s.stage === 1 || s.stage === 2) && s.nextAt !== null && e.now >= s.nextAt) {
        return climb(s, e.now, t, "timer");
      }
      return { state: s, effects: [] };
    }
    case "ack": {
      if (s.stage === 0) return { state: s, effects: [] };
      const acks = [...s.acks.filter((a) => a.name !== e.by), { name: e.by, at: e.now }];
      const nextAt = s.nextAt === null ? null : Math.max(s.nextAt, e.now + t.ackHoldMs);
      return { state: { ...s, acks, nextAt }, effects: [{ type: "paused", by: e.by, until: nextAt ?? e.now }] };
    }
    case "escalate": {
      if (s.stage === 3) return { state: s, effects: [] };
      return climb(s, e.now, t, `manual (${e.by})`);
    }
    case "resolve": {
      const effects: Effect[] = [{ type: "resolved", by: e.by, how: e.how, fromStage: s.stage }];
      return { state: { ...initialEscalation(e.now), lastProbeAt: s.lastProbeAt }, effects };
    }
  }
}

function climb(s: EscState, now: number, t: Timers, trigger: string) {
  const next = (s.stage + 1) as Stage;
  if (next === 1) return enter(s, 1, now, t, [{ type: "alertBuddies", trigger }, { type: "probe", reason: "alert" }]);
  if (next === 2) return enter(s, 2, now, t, [{ type: "bystander" }]);
  return enter(s, 3, now, t, [{ type: "notifyContact" }]);
}

function enter(s: EscState, stage: Stage, now: number, t: Timers, effects: Effect[]) {
  const nextAt = stage === 1 ? now + t.l1ToL2Ms : stage === 2 ? now + t.l2ToL3Ms : null;
  return { state: { ...s, stage, stageSince: now, nextAt }, effects };
}
