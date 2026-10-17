import { describe, expect, test } from "bun:test";
import { initialEscalation, step, type EscEvent, type EscState } from "../src/server/escalation.ts";
import { DEMO_TIMERS as T } from "../src/shared/config.ts";
import type { RiskAssessment } from "../src/shared/types.ts";

const risk = (level: RiskAssessment["level"], code = "fall"): RiskAssessment => ({
  score: level === "alert" ? 70 : level === "watch" ? 35 : 0,
  level,
  reasons: level === "ok" ? [] : [{ code: code as any, text: code, weight: 35 }],
  summary: level === "ok" ? "all good" : code,
});

function run(events: EscEvent[], s: EscState = initialEscalation(0)) {
  const effects: string[] = [];
  for (const e of events) {
    const r = step(s, e, T);
    s = r.state;
    effects.push(...r.effects.map((x) => x.type));
  }
  return { s, effects };
}

describe("escalation ladder", () => {
  test("ok risk does nothing", () => {
    const { s, effects } = run([{ type: "risk", now: 1, risk: risk("ok") }, { type: "tick", now: 100_000 }]);
    expect(s.stage).toBe(0);
    expect(effects).toEqual([]);
  });

  test("watch triggers a probing check-in, rate-limited by the cooldown", () => {
    const { s, effects } = run([
      { type: "risk", now: 1000, risk: risk("watch") },
      { type: "risk", now: 2000, risk: risk("watch") },
      { type: "risk", now: 1000 + T.probeCooldownMs, risk: risk("watch") },
    ]);
    expect(s.stage).toBe(0);
    expect(effects).toEqual(["probe", "probe"]);
  });

  test("alert climbs L1 -> L2 -> L3 on timers when nobody responds", () => {
    const t1 = 10_000;
    const { s, effects } = run([
      { type: "risk", now: t1, risk: risk("alert") },
      { type: "tick", now: t1 + T.l1ToL2Ms - 1 },
      { type: "tick", now: t1 + T.l1ToL2Ms },
      { type: "tick", now: t1 + T.l1ToL2Ms + T.l2ToL3Ms },
      { type: "tick", now: t1 + 10 * T.l2ToL3Ms },
    ]);
    expect(effects).toEqual(["alertBuddies", "probe", "bystander", "notifyContact"]);
    expect(s.stage).toBe(3);
    expect(s.nextAt).toBeNull();
  });

  test("a buddy ack pauses the ladder for ackHoldMs, then it resumes", () => {
    const t1 = 10_000;
    const ackAt = t1 + 5_000;
    const { s, effects } = run([
      { type: "risk", now: t1, risk: risk("alert") },
      { type: "ack", now: ackAt, by: "Sam" },
      { type: "tick", now: t1 + T.l1ToL2Ms },
    ]);
    expect(s.stage).toBe(1);
    expect(s.acks).toEqual([{ name: "Sam", at: ackAt }]);
    expect(effects).toEqual(["alertBuddies", "probe", "paused"]);
    const later = step(s, { type: "tick", now: ackAt + T.ackHoldMs }, T);
    expect(later.state.stage).toBe(2);
    expect(later.effects.map((e) => e.type)).toEqual(["bystander"]);
  });

  test("repeated acks from the same buddy are deduplicated", () => {
    const { s } = run([
      { type: "risk", now: 0, risk: risk("alert") },
      { type: "ack", now: 1, by: "Sam" },
      { type: "ack", now: 2, by: "Sam" },
      { type: "ack", now: 3, by: "Alex" },
    ]);
    expect(s.acks.map((a) => a.name)).toEqual(["Sam", "Alex"]);
  });

  test("acks are ignored while monitoring", () => {
    const { s, effects } = run([{ type: "ack", now: 1, by: "Sam" }]);
    expect(s.acks).toEqual([]);
    expect(effects).toEqual([]);
  });

  test("manual escalation skips the wait and stops at L3", () => {
    const { s, effects } = run([
      { type: "escalate", now: 1, by: "Sam" },
      { type: "escalate", now: 2, by: "Sam" },
      { type: "escalate", now: 3, by: "Sam" },
      { type: "escalate", now: 4, by: "Sam" },
    ]);
    expect(s.stage).toBe(3);
    expect(effects).toEqual(["alertBuddies", "probe", "bystander", "notifyContact"]);
  });

  test("resolve returns to monitoring from any level", () => {
    for (const n of [1, 2, 3]) {
      const ups: EscEvent[] = Array.from({ length: n }, (_, i) => ({ type: "escalate", now: i, by: "demo" }));
      const { s, effects } = run([...ups, { type: "resolve", now: 99, by: "Yeyito", how: "PIN" }]);
      expect(s.stage).toBe(0);
      expect(s.acks).toEqual([]);
      expect(s.nextAt).toBeNull();
      expect(effects.at(-1)).toBe("resolved");
    }
  });

  test("an already-escalated ladder ignores further alert-level risk", () => {
    const { s, effects } = run([
      { type: "risk", now: 0, risk: risk("alert") },
      { type: "risk", now: 1, risk: risk("alert") },
      { type: "risk", now: 2, risk: risk("watch") },
    ]);
    expect(s.stage).toBe(1);
    expect(effects).toEqual(["alertBuddies", "probe"]);
  });
});
