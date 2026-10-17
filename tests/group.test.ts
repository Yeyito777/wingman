// Group engine without a server: distances, fan-out targets, privacy and push routing.

import { describe, expect, test } from "bun:test";
import { Group, type GroupHooks } from "../src/server/group.ts";
import type { PushMessage } from "../src/server/push.ts";
import { offset } from "../src/shared/geo.ts";
import type { ServerMsg } from "../src/shared/types.ts";

const HERE = { lat: 43.6487, lng: -79.3962 };

function harness() {
  const sent: { to: string[] | "all"; msg: ServerMsg; viewer: string | null }[] = [];
  const pushes: PushMessage[] = [];
  const hooks: GroupHooks = {
    notifier: { name: "simulated", send: async () => [] },
    pusher: { name: "expo", send: async (m) => (pushes.push(m), { ok: true, detail: "test" }) },
    scorerName: "mock",
    broadcast: () => {},
    send: (_g, to, build) => {
      for (const v of to === "all" ? [null, "x"] : to) sent.push({ to, msg: build(v), viewer: v });
    },
  };
  const g = new Group("ABCDEF", { name: "Test" }, hooks, 1_000);
  const add = (name: string) => g.addMember({ name, pin: "1234", consent: true, medical: "asthma", emergencyContact: { name: "Mom", phone: "+14165550199" } }, 1_000);
  return { g, add, sent, pushes };
}

describe("group engine", () => {
  test("distance from the group is to the nearest other member, beyond GPS uncertainty", () => {
    const { g, add } = harness();
    const [a, b, c] = [add("A"), add("B"), add("C")];
    const now = 2_000;
    g.setFix(a, { ...HERE, accuracy: 10 }, now);
    g.setFix(b, { ...offset(HERE, 100, 90), accuracy: 10 }, now);
    g.setFix(c, { ...offset(HERE, 400, 90), accuracy: 10 }, now);
    const d = g.distance(c, now);
    expect(d.nearestId).toBe(b.id);
    expect(d.awayM).toBeCloseTo(300 - 20, -1);
    expect(d.centroidM!).toBeGreaterThan(d.awayM!);
    expect(g.risk(c, now).reasons.map((r) => r.code)).toContain("away_from_group");
    // B is near A, so B isn't "away" even though C is far.
    expect(g.distance(b, now).nearestId).toBe(a.id);
    expect(g.distance(b, now).awayM).toBeLessThan(150);
  });

  test("stale or inaccurate fixes don't anchor the group; alone falls back to the venue", () => {
    const { g, add } = harness();
    const [a, b] = [add("A"), add("B")];
    g.setFix(a, { ...HERE, accuracy: 10 }, 2_000); // also becomes the venue
    g.setFix(b, { ...offset(HERE, 500, 0), accuracy: 400 }, 2_000);
    expect(g.distance(a, 2_000).from).toBe("venue");
    g.setFix(b, { ...offset(HERE, 50, 0), accuracy: 10 }, 2_000);
    expect(g.distance(a, 2_000).from).toBe("group");
    expect(g.distance(a, 2_000 + 4 * 60_000).from).toBe("venue"); // B's fix went stale
  });

  test("an alert goes to everyone, flagged `you` only for the member in trouble; push only to backgrounded friends", () => {
    const { g, add, sent, pushes } = harness();
    const [a, b, c] = [add("A"), add("B"), add("C")];
    b.pushToken = { kind: "expo", token: "ExponentPushToken[b]" };
    c.pushToken = { kind: "expo", token: "ExponentPushToken[c]" };
    b.appState = "background";
    g.escalate(a, "C", 3_000);
    const alerts = sent.filter((s) => s.msg.t === "alert");
    expect(alerts.length).toBeGreaterThan(0);
    for (const s of alerts) expect((s.msg as any).you).toBe(s.viewer === a.id);
    expect(pushes.map((p) => p.token.token)).toEqual(["ExponentPushToken[b]"]); // C is in the foreground
    expect(pushes[0]!.title).toBe("A may need help");
  });

  test("privacy: friends see medical info and the contact number only during that member's alert", () => {
    const { g, add } = harness();
    const [a, b] = [add("A"), add("B")];
    let v = g.view(b.id, 3_000).members.find((m) => m.id === a.id)!;
    expect(v.medical).toBe("");
    expect(v.emergencyContact.phone).not.toContain("5550199");
    expect(g.view(a.id, 3_000).members[0]!.medical).toBe("asthma");
    g.escalate(a, "B", 3_000);
    v = g.view(b.id, 3_000).members.find((m) => m.id === a.id)!;
    expect(v.medical).toBe("asthma");
    expect(v.emergencyContact.phone).toBe("+14165550199");
    expect(g.view(b.id, 3_000).alerts.map((x) => x.memberId)).toEqual([a.id]);
  });
});
