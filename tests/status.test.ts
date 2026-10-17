// The stage card's status line only claims "with the group" when the server measured it.

import { describe, expect, test } from "bun:test";
import { statusLine } from "../src/client/status.ts";
import type { MemberView } from "../src/shared/types.ts";

const base = {
  risk: { score: 0, level: "ok", reasons: [], summary: "" },
  distanceFromGroupM: null,
  presence: "online",
  fix: null,
  shareLocation: "always",
  signals: { sensors: { motion: "on", location: "on", mic: "on", notifications: "on" } },
} as unknown as MemberView;
const m = (o: Record<string, unknown>) => ({ ...base, ...o }) as MemberView;

describe("stage card status line", () => {
  test("measured distance", () => {
    expect(statusLine(m({ distanceFromGroupM: 0 }))).toBe("With the group");
    expect(statusLine(m({ distanceFromGroupM: 40 }))).toBe("With the group · 40 m");
    expect(statusLine(m({ distanceFromGroupM: 310 }))).toBe("310 m from the group");
  });
  test("no measured distance is never 'with the group'", () => {
    expect(statusLine(m({}))).toBe("Waiting for location…");
    expect(statusLine(m({ fix: { lat: 43.66, lng: -79.39, accuracy: 1500, at: 0 } }))).toBe("Approximate location (±1.5 km)");
    expect(statusLine(m({ signals: { sensors: { location: "denied" } } }))).toBe("Location is off on this phone");
    expect(statusLine(m({ shareLocation: "alert" }))).toBe("Shares location only during an alert");
    expect(statusLine(m({ presence: "offline" }))).toBe("Not connected yet");
  });
  test("risk reasons win", () => {
    expect(statusLine(m({ distanceFromGroupM: 0, risk: { score: 30, level: "watch", reasons: [{}], summary: "fall detected just now" } }))).toBe("Fall detected just now");
  });
});
