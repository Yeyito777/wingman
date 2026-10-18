// Group engine without a server: distances, fan-out targets, privacy and push routing.

import { describe, expect, test } from "bun:test";
import { CANNED, Group, type GroupHooks } from "../src/server/group.ts";
import { ANSWER_GRACE_MS } from "../src/shared/config.ts";
import type { PushMessage } from "../src/server/push.ts";
import { haversineM, offset } from "../src/shared/geo.ts";
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

  test("demo: simulated friends gather around the real phone, even 30 km from the default venue or with a coarse fix", () => {
    const hooks = harness().g.hooks;
    const GERSTEIN = { lat: 43.6623, lng: -79.3941 };
    for (const accuracy of [35, 1500]) {
      const g = new Group("DEMO01", { demo: true }, hooks, 1_000);
      const sam = g.addMember({ name: "Sam", pin: "0000", consent: true }, 1_000, true);
      expect(g.name).toBe(""); // simulated friends don't name the group
      const me = g.addMember({ name: "Yeyito", pin: "1234", consent: true }, 1_000);
      expect(g.name).toBe("Yeyito's night out");
      g.setFix(me, { ...GERSTEIN, accuracy }, 2_000);
      const samAt = g.position(sam, 2_000)!;
      expect(haversineM(samAt, GERSTEIN)).toBeLessThan(100);
      const v = g.view(null, 2_000).members.find((m) => m.id === me.id)!;
      expect(v.fix).not.toBeNull(); // the stage view gets the phone's pin
    }
  });

  test("demo: the venue doesn't chase the phone during a simulated walk", () => {
    const { g: base } = harness();
    const g = new Group("DEMO02", { demo: true }, base.hooks, 1_000);
    g.addMember({ name: "Sam", pin: "0000", consent: true }, 1_000, true);
    const me = g.addMember({ name: "Yeyito", pin: "1234", consent: true }, 1_000);
    g.setFix(me, { ...HERE, accuracy: 20 }, 2_000);
    const venue = { ...g.venue! };
    g.startWalk(me, 3_000);
    g.setFix(me, { ...offset(HERE, 5000, 90), accuracy: 20 }, 4_000);
    expect(g.venue!.lat).toBe(venue.lat);
  });

  describe("a check-in being answered doesn't time out", () => {
    // A fall (30) triggers a check-in (60 s in real timers); missing it (+35) raises the alert.
    const setup = () => {
      const { g, add } = harness();
      const [a] = [add("A"), add("B")];
      g.fall(a, 10_000, 3.4);
      const c = a.pendingCheckin!;
      expect(c.deadline).toBe(10_000 + g.timers.checkinTimeoutMs);
      /** tick once a second until `to`; returns when A's alert started (or null) */
      const run = (from: number, to: number) => {
        for (let t = from; t <= to; t += 1000) {
          g.tick(t);
          if (a.esc.stage > 0) return t;
        }
        return null;
      };
      return { g, a, c, run };
    };

    test("never started: missed at the normal timeout → alert", () => {
      const { a, c, run } = setup();
      expect(run(11_000, 69_000)).toBeNull();
      expect(run(70_000, 75_000)).toBe(70_000);
      expect(c.outcome).toBe("missed");
      expect(a.esc.stage).toBe(1);
    });

    test("started answering, then submitted: no alert, even past the original deadline", async () => {
      const { g, a, c, run } = setup();
      expect(run(11_000, 50_000)).toBeNull();
      for (let t = 55_000; t <= 115_000; t += 10_000) {
        g.signals(a, { answering: c.id }, t); // recording / typing, a heartbeat every 10 s
        expect(run(t - 9_000, t)).toBeNull();
      }
      expect(c.answeringAt).toBe(115_000);
      expect(c.status).toBe("pending");
      await g.answerCheckin(a, c.id, { text: CANNED.coherent, source: "typed", canned: true });
      expect(c.outcome).toBe("ok");
      expect(run(116_000, 300_000)).toBeNull();
    });

    test("started, then the phone went silent: alert ~50 s after the last activity (the cap)", () => {
      const { g, a, c, run } = setup();
      expect(run(11_000, 50_000)).toBeNull();
      g.signals(a, { answering: c.id }, 50_000);
      expect(c.deadline).toBe(50_000 + ANSWER_GRACE_MS);
      expect(run(51_000, 99_000)).toBeNull();
      expect(run(100_000, 110_000)).toBe(100_000);
      expect(c.outcome).toBe("missed");
    });

    test("an answering signal for another (or a finished) check-in changes nothing", () => {
      const { g, a, c } = setup();
      g.signals(a, { answering: "c_other" }, 30_000);
      expect(c.deadline).toBe(70_000);
      expect(c.answeringAt).toBeUndefined();
    });
  });
});

