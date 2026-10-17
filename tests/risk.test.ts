import { describe, expect, test } from "bun:test";
import { assessRisk, type RiskInput } from "../src/server/risk.ts";
import { REAL_TIMERS } from "../src/shared/config.ts";

const T0 = 1_800_000_000_000;
const MIN = 60_000;

function input(over: Partial<RiskInput> = {}): RiskInput {
  return {
    now: T0 + 10 * MIN,
    timers: REAL_TIMERS,
    sessionStartedAt: T0,
    clearedAt: T0,
    fallAt: null,
    lastMotionAt: T0 + 9 * MIN,
    lastInteractionAt: T0 + 9 * MIN,
    lastHeartbeatAt: T0 + 10 * MIN - 5_000,
    awayM: 20,
    awaySince: null,
    awayFrom: "group",
    outsideGeofence: false,
    geofenceSince: null,
    checkins: [],
    localHour: 23,
    ...over,
  };
}

describe("risk engine", () => {
  test("quiet night is ok with no reasons", () => {
    const r = assessRisk(input());
    expect(r.level).toBe("ok");
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual([]);
    expect(r.summary).toBe("all good");
  });

  test("a fall alone is suspicious (watch), not an alert", () => {
    const r = assessRisk(input({ fallAt: T0 + 8 * MIN }));
    expect(r.level).toBe("watch");
    expect(r.summary).toBe("fall detected 2 min ago");
  });

  test("fall + missed check-in + far from group is an alert with readable reasons", () => {
    const r = assessRisk(
      input({
        fallAt: T0 + 8 * MIN,
        awayM: 310,
        awaySince: T0 + 5 * MIN,
        checkins: [{ at: T0 + 9 * MIN, outcome: "missed", impairment: 1, reason: "" }],
      }),
    );
    expect(r.level).toBe("alert");
    expect(r.summary).toBe("missed a check-in + fall detected 2 min ago + 310 m from your group");
    expect(r.reasons.map((x) => x.code)).toEqual(["missed_checkin", "fall", "away_from_group"]);
  });

  test("a coherent check-in clears earlier signals", () => {
    const r = assessRisk(
      input({
        fallAt: T0 + 8 * MIN,
        clearedAt: T0 + 9 * MIN,
        checkins: [{ at: T0 + 8.5 * MIN, outcome: "missed", impairment: 1, reason: "" }],
      }),
    );
    expect(r.level).toBe("ok");
  });

  test("being away is not re-flagged after the person confirmed they are fine", () => {
    const away = { awayM: 500, awaySince: T0 + 2 * MIN };
    expect(assessRisk(input(away)).level).toBe("watch");
    expect(assessRisk(input({ ...away, clearedAt: T0 + 3 * MIN })).level).toBe("ok");
  });

  test("impairment weight scales with the model's impairment score", () => {
    const mk = (imp: number) =>
      assessRisk(input({ checkins: [{ at: T0 + 9 * MIN, outcome: "impaired", impairment: imp, reason: "slurred speech" }] }));
    expect(mk(0.5).score).toBe(20);
    expect(mk(1).score).toBe(60);
    expect(mk(0.85).level).toBe("watch");
    expect(mk(0.85).summary).toBe("check-in answer sounded impaired: slurred speech");
  });

  test("two missed check-ins alone trigger an alert", () => {
    const r = assessRisk(
      input({
        checkins: [
          { at: T0 + 5 * MIN, outcome: "missed", impairment: 1, reason: "" },
          { at: T0 + 9 * MIN, outcome: "missed", impairment: 1, reason: "" },
        ],
      }),
    );
    expect(r.level).toBe("alert");
    expect(r.summary).toBe("missed 2 check-ins in a row");
  });

  test("phone going silent is a dead-man's switch that a check-in cannot clear", () => {
    const r = assessRisk(input({ lastHeartbeatAt: T0 + 7 * MIN, clearedAt: T0 + 9 * MIN }));
    expect(r.reasons[0]!.code).toBe("offline");
    expect(r.summary).toBe("phone went silent 3 min ago");
    expect(r.level).toBe("watch");
  });

  test("prolonged stillness and an untouched phone count, more so late at night", () => {
    const quiet = input({ now: T0 + 50 * MIN, lastMotionAt: T0, lastInteractionAt: T0, lastHeartbeatAt: T0 + 50 * MIN });
    const evening = assessRisk(quiet);
    expect(evening.reasons.map((r) => r.code)).toEqual(["stillness", "untouched"]);
    expect(evening.level).toBe("watch");
    const late = assessRisk({ ...quiet, localHour: 3 });
    expect(late.score).toBe(evening.score + 10);
    expect(late.summary).toContain("it's 3 AM");
  });

  test("late night alone adds nothing", () => {
    expect(assessRisk(input({ localHour: 3 })).score).toBe(0);
  });

  test("score is capped at 100", () => {
    const r = assessRisk(
      input({
        fallAt: T0 + 9 * MIN,
        awayM: 900,
        awaySince: T0 + 1,
        lastHeartbeatAt: T0 + 1,
        localHour: 2,
        checkins: [
          { at: T0 + 2 * MIN, outcome: "missed", impairment: 1, reason: "" },
          { at: T0 + 3 * MIN, outcome: "missed", impairment: 1, reason: "" },
        ],
      }),
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe("alert");
  });

  test("is deterministic", () => {
    const i = input({ fallAt: T0 + 8 * MIN, awayM: 400, awaySince: T0 + 1 });
    expect(assessRisk(i)).toEqual(assessRisk(i));
  });
});
