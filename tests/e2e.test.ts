// End-to-end: a real server and several group members connected over HTTP + WebSocket (the same protocol the
// iPhone app speaks), driving the stage storyline and asserting the escalation sequence and the alert fan-out.
// Uses the deterministic mock scorer so it never touches a rate-limited AI API.
// Set E2E_LIVE_AI=1 (with GEMINI_API_KEY) to also push one real iOS-style .m4a clip through Gemini.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server/app.ts";
import { availableEngines, geminiMime } from "../src/server/scorer.ts";
import { DEMO_TIMERS } from "../src/shared/config.ts";
import { STORY } from "../src/shared/story.ts";
import { parseJoinLink, type GroupView, type JoinResponse, type MemberView, type ServerMsg } from "../shared/protocol.ts";

let app: ReturnType<typeof startServer>;

beforeAll(() => {
  app = startServer({ port: 0, engines: ["mock"], quiet: true, tickMs: 50 });
});
afterAll(() => app.stop());

const FAST = { l1ToL2Ms: 1500, l2ToL3Ms: 1500, checkinTimeoutMs: 5000, ackHoldMs: 60_000, probeCooldownMs: 300, fallConfirmMs: 500 };
const VENUE = { lat: 43.6487, lng: -79.3962 };

async function call(path: string, key: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = body instanceof Uint8Array;
  const res = await fetch(app.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(raw ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

/** A member's phone: WebSocket with the latest view, every discrete message, and the stage history per member. */
function phone(j: { code: string; memberId?: string; key: string }) {
  const q = new URLSearchParams({ g: j.code, k: j.key, ...(j.memberId ? { m: j.memberId } : {}) });
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/ws?${q}`);
  const p = {
    ws,
    id: j.memberId ?? null,
    key: j.key,
    view: null as GroupView | null,
    msgs: [] as ServerMsg[],
    stages: new Map<string, number[]>(),
    member(id: string) {
      return p.view?.members.find((m) => m.id === id) as MemberView | undefined;
    },
    of(t: ServerMsg["t"]) {
      return p.msgs.filter((m) => m.t === t) as any[];
    },
    send(msg: unknown) {
      ws.send(JSON.stringify(msg));
    },
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg;
    p.msgs.push(m);
    if (m.t === "hello" || m.t === "view") {
      p.view = m.view;
      for (const mv of m.view.members) {
        const h = p.stages.get(mv.id) ?? [];
        const s = mv.alert?.stage ?? 0;
        if (h.at(-1) !== s) h.push(s);
        p.stages.set(mv.id, h);
      }
    }
  };
  return p;
}

async function until<T>(what: string, fn: () => T | null | undefined | false, ms = 6000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await Bun.sleep(25);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const setup = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  pin: "1234",
  consent: true,
  medical: `${name}: allergic to penicillin`,
  emergencyContact: { name: `${name}'s mom`, phone: "+14165550199" },
  ...over,
});

async function newGroup(names: string[], opts: { demo?: boolean; over?: Record<string, unknown> } = {}) {
  const c = await call("/api/groups", "", { groupName: "Friday at the Rex", demo: opts.demo ?? true, member: setup(names[0]!, opts.over) });
  expect(c.status).toBe(200);
  const joins: JoinResponse[] = [c.body];
  for (const n of names.slice(1)) {
    const j = await call(`/api/groups/${c.body.code.toLowerCase()}/join`, "", setup(n));
    expect(j.status).toBe(200);
    joins.push(j.body);
  }
  if (opts.demo ?? true) expect((await call(`/api/groups/${c.body.code}/demo/timers`, c.body.key, { timers: FAST })).status).toBe(200);
  return { code: c.body.code as string, joins };
}

const fixNear = (i: number) => ({ heartbeat: true, appState: "foreground", battery: 0.8, fix: { lat: VENUE.lat + i * 0.00003, lng: VENUE.lng, accuracy: 10 }, sensors: { motion: "on", location: "on", mic: "on" } });

describe("group storyline (3 real WebSocket members)", () => {
  test("drift → fall → slurred → everyone else alerted → L2 → L3 → friend acks → wrong PIN → found & OK → end deletes", async () => {
    const { code, joins } = await newGroup(["Maya", "Sam", "Leo"]);
    const [maya, sam, leo] = joins.map((j) => phone(j));
    await until("all connected", () => maya!.view && sam!.view && leo!.view);
    const M = joins[0]!.memberId;
    const S = joins[1]!.memberId;

    // Everyone reports a position next to each other (REST for two, WS for one).
    await call(`/api/groups/${code}/members/${M}/signals`, maya!.key, fixNear(0));
    await call(`/api/groups/${code}/members/${S}/signals`, sam!.key, fixNear(1));
    leo!.send({ t: "signals", ...fixNear(2) });
    await until("group distances known", () => sam!.member(M)?.distanceFromGroupM === 0 && sam!.member(M)?.nearestMemberId);
    expect(sam!.view!.members[0]!.isYou).toBe(true);
    expect(sam!.view!.you).toBe(S);
    // Privacy outside an alert: friends don't see medical info or the contact's full number.
    expect(sam!.member(M)!.medical).toBe("");
    expect(sam!.member(M)!.emergencyContact.phone).toBe("+•••••••••99");
    expect(maya!.member(M)!.medical).toContain("penicillin");

    // Wrong-person checks.
    expect((await call(`/api/groups/${code}/members/${M}/signals`, sam!.key, { heartbeat: true })).status).toBe(403);
    expect((await call(`/api/groups/${code}/members/${M}/ack`, sam!.key, {})).status).toBe(409); // not in alert yet

    // ② Maya drifts 350 m away from everyone.
    await call(`/api/groups/${code}/demo/walk`, maya!.key, { target: M, durationMs: 300 });
    await until("away from group", () => sam!.member(M)?.risk.reasons.some((r) => r.code === "away_from_group"));
    expect(sam!.member(M)!.risk.summary).toMatch(/from your group/);
    // ③ fall, ④ slurred answer to the pending check-in.
    await call(`/api/groups/${code}/demo/fall`, maya!.key, { target: M });
    await until("watch-level check-in", () => maya!.member(M)?.checkin?.status === "pending");
    expect(maya!.of("checkin").length).toBeGreaterThan(0); // the server asked Maya's phone directly
    expect(sam!.of("checkin").length).toBe(0);
    await call(`/api/groups/${code}/demo/slurred`, maya!.key, { target: M, delayMs: 0, wait: true });

    // L1: every OTHER member gets an alert about Maya; Maya gets told her friends were alerted.
    await until("Sam alerted", () => sam!.of("alert").some((a) => a.alert.memberId === M && a.alert.stage === 1 && !a.you));
    await until("Leo alerted", () => leo!.of("alert").some((a) => a.alert.memberId === M && a.alert.stage === 1));
    expect(maya!.of("alert").find((a) => a.alert.stage === 1)?.you).toBe(true);
    const mv = sam!.member(M)!;
    expect(mv.risk.summary).toMatch(/check-in answer sounded impaired.*fall detected.*from your group/);
    expect(mv.medical).toContain("penicillin"); // revealed during the alert
    expect(mv.lastCheckin?.result?.transcript).toContain("m'fine");
    expect(sam!.member(S)!.alert).toBeNull(); // Sam's own ladder is untouched

    // L2 bystander on Maya's phone, then L3 SMS to Maya's contact.
    await until("bystander", () => maya!.of("alert").some((a) => a.alert.stage === 2 && a.you && a.alert.bystander));
    await until("L3 notified", () => leo!.view?.notifications.some((n) => n.aboutMemberId === M && n.channel === "sms"));
    const sms = leo!.view!.notifications.find((n) => n.aboutMemberId === M)!;
    expect(sms.simulated).toBe(true);
    expect(sms.body).toContain("Maya may need help");
    expect(sms.body).toContain("Sam, Leo");

    // ⑤ Sam: on my way. Everyone sees it.
    expect((await call(`/api/groups/${code}/members/${M}/ack`, maya!.key, {})).status).toBe(400); // can't ack yourself
    expect((await call(`/api/groups/${code}/members/${M}/ack`, sam!.key, {})).status).toBe(200);
    await until("ack visible to Maya", () => maya!.of("ack").some((a) => a.ack.byName === "Sam" && a.you));
    await until("ack in Leo's view", () => leo!.member(M)?.alert?.acks.some((a) => a.by === S));

    // Wrong PIN rejected, then Leo finds her: "found & OK".
    const bad = await call(`/api/groups/${code}/members/${M}/resolve`, maya!.key, { pin: "9999" });
    expect(bad.status).toBe(401);
    expect(bad.body.attemptsLeft).toBe(2);
    expect(maya!.member(M)!.alert).not.toBeNull();
    expect((await call(`/api/groups/${code}/members/${M}/resolve`, leo!.key, { note: "with her at the bar" })).status).toBe(200);
    await until("resolved everywhere", () => sam!.of("resolved").some((r) => r.memberId === M && r.by === "Leo") && maya!.member(M)?.alert === null);

    expect(sam!.stages.get(M)).toEqual([0, 1, 2, 3, 0]);
    expect(maya!.stages.get(M)).toEqual([0, 1, 2, 3, 0]);
    expect(sam!.stages.get(S)).toEqual([0]);

    // The log tells the story in order.
    const texts = leo!.view!.events.map((e) => e.text);
    const idx = (re: RegExp) => texts.findIndex((t) => re.test(t));
    const order = [/walking away/, /fall detected/i, /sounded impaired/, /LEVEL 1 · Maya/, /LEVEL 2/, /LEVEL 3/, /Sam is on the way to Maya/, /Wrong PIN/, /resolved by Leo/];
    const positions = order.map(idx);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // End night (any member): everyone is told, and the group is gone.
    expect((await call(`/api/groups/${code}/end`, sam!.key, {})).status).toBe(200);
    await until("ended on every phone", () => [maya, sam, leo].every((p) => p!.of("ended").length === 1));
    expect((await call(`/api/groups/${code}`, "")).status).toBe(404);
    expect(app.groups.has(code)).toBe(false);
    for (const p of [maya, sam, leo]) p!.ws.close();
  }, 20_000);

  test("several members can be in alert at once; alerts are independent", async () => {
    const { code, joins } = await newGroup(["Ana", "Ben", "Cy"]);
    const [a, b, c] = joins;
    const pc = phone(c!);
    await until("connected", () => pc.view);
    await call(`/api/groups/${code}/members/${a!.memberId}/escalate`, c!.key, {});
    await call(`/api/groups/${code}/members/${b!.memberId}/escalate`, c!.key, {});
    await call(`/api/groups/${code}/members/${b!.memberId}/escalate`, c!.key, {});
    await until("two alerts", () => pc.view?.alerts.length === 2 && pc.view.alerts[0]!.stage === 2);
    expect(pc.view!.alerts.map((x) => [x.memberName, x.stage])).toEqual([["Ben", 2], ["Ana", 1]]);
    // Ana cancels her own with her PIN; Ben's stays.
    expect((await call(`/api/groups/${code}/members/${a!.memberId}/resolve`, a!.key, { pin: "1234" })).status).toBe(200);
    await until("one alert left", () => pc.view?.alerts.length === 1 && pc.view.alerts[0]!.memberName === "Ben");
    await call(`/api/groups/${code}/end`, a!.key, {});
    pc.ws.close();
  });
});

describe("check-ins", () => {
  test("iOS .m4a answers (base64 JSON and raw body), typed answers, and a friend's ping", async () => {
    const { code, joins } = await newGroup(["Maya", "Sam"]);
    const [m, s] = joins;
    const m4a = new Uint8Array(await Bun.file("tests/fixtures/coherent.m4a").arrayBuffer());
    const ask = async () => (await call(`/api/groups/${code}/members/${m!.memberId}/checkins`, m!.key, {})).body.checkin;

    let c = await ask();
    expect(c.autoListen).toBe(true); // "check in now" listens right away
    let r = await call(`/api/groups/${code}/members/${m!.memberId}/checkins/${c.id}/answer`, m!.key, { audio: Buffer.from(m4a).toString("base64"), mime: "audio/m4a", durationMs: 4000 });
    expect(r.status).toBe(200);
    expect(r.body.checkin.outcome).toBe("ok");
    // Answering twice is rejected.
    expect((await call(`/api/groups/${code}/members/${m!.memberId}/checkins/${c.id}/answer`, m!.key, { text: "again" })).status).toBe(409);

    c = await ask();
    r = await call(`/api/groups/${code}/members/${m!.memberId}/checkins/${c.id}/answer`, m!.key, m4a, { "content-type": "audio/x-m4a" });
    expect(r.body.checkin.outcome).toBe("ok");

    // Sam pings Maya; only Maya can answer.
    const ping = await call(`/api/groups/${code}/members/${m!.memberId}/checkins`, s!.key, {});
    expect(ping.body.checkin.trigger).toBe("requested by Sam");
    expect((await call(`/api/groups/${code}/members/${m!.memberId}/checkins/${ping.body.checkin.id}/answer`, s!.key, { text: "hi" })).status).toBe(403);
    r = await call(`/api/groups/${code}/members/${m!.memberId}/checkins/${ping.body.checkin.id}/answer`, m!.key, { text: "Uhh... dunno... where am i" });
    expect(r.body.checkin.outcome).toBe("impaired");
    // A clearly impaired answer raises the alert by itself, so Sam now sees the words too (revealed during an alert).
    const sv = (await call(`/api/groups/${code}/view`, s!.key)).body as GroupView;
    const mm = sv.members.find((x) => x.id === m!.memberId)!;
    expect(mm.lastCheckin?.outcome).toBe("impaired");
    expect(mm.lastCheckin?.result?.reason).toBeTruthy();
    expect(mm.alert?.stage).toBe(1);
    expect(mm.lastCheckin?.result?.transcript).toBe("Uhh... dunno... where am i");
    await call(`/api/groups/${code}/end`, m!.key, {});
  });

  test("iOS audio MIME types are normalised for Gemini", () => {
    expect(["audio/m4a", "audio/x-m4a", "audio/mp4", "audio/MP4; codecs=mp4a.40.2"].map(geminiMime)).toEqual(["audio/mp4", "audio/mp4", "audio/mp4", "audio/mp4"]);
    expect(geminiMime("audio/aac")).toBe("audio/aac");
    expect(geminiMime("audio/x-wav")).toBe("audio/wav");
  });

  test("'real audio' demo answers stay safe offline: if no AI can hear the clip, the script decides", async () => {
    const { code, joins } = await newGroup(["Maya", "Sam"]);
    const m = joins[0]!;
    await call(`/api/groups/${code}/demo/mode`, m.key, { mode: "live" });
    await call(`/api/groups/${code}/demo/slurred`, m.key, { target: m.memberId, delayMs: 0, wait: true });
    const v = (await call(`/api/groups/${code}/view`, m.key)).body as GroupView;
    const c = v.members[0]!.lastCheckin!;
    expect(c.result!.engine).toBe("mock");
    expect(c.outcome).toBe("impaired"); // not "ok", which would silently cancel the demo's alert
    await call(`/api/groups/${code}/end`, m.key, {});
  });

  const live = process.env.E2E_LIVE_AI === "1" && availableEngines()[0] !== "mock";
  test.skipIf(!live)("live Gemini scores a real iOS-style .m4a slurred clip as impaired (one API call)", async () => {
    const srv = startServer({ port: 0, quiet: true });
    try {
      const post = (p: string, key: string, b: unknown) => fetch(srv.url + p, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json() as any);
      const j = await post("/api/groups", "", { member: setup("Maya") });
      const c = (await post(`/api/groups/${j.code}/members/${j.memberId}/checkins`, j.key, {})).checkin;
      const m4a = Buffer.from(await Bun.file("tests/fixtures/slurred.m4a").arrayBuffer()).toString("base64");
      const r = await post(`/api/groups/${j.code}/members/${j.memberId}/checkins/${c.id}/answer`, j.key, { audio: m4a, mime: "audio/m4a" });
      console.log(`[live AI] ${r.checkin.result.engine} ${r.checkin.result.model} ${r.checkin.result.latencyMs} ms: ${r.checkin.result.reason} | "${r.checkin.result.transcript}"`);
      expect(r.checkin.result.engine).toBe("gemini");
      expect(r.checkin.outcome).toBe("impaired");
    } finally {
      srv.stop();
    }
  }, 40_000);
});

describe("demo groups and the stage view", () => {
  test("simulated friends heartbeat, answer check-ins, and the storyline can target a real phone or a friend", async () => {
    const d = await call("/api/demo", "", { presenterName: "Yeyito" });
    expect(d.status).toBe(200);
    const { code, stageKey } = d.body;
    const stage = phone({ code, key: stageKey });
    await until("stage hello", () => stage.view);
    expect(stage.view!.you).toBeNull();
    expect(stage.view!.members.map((m) => [m.name, m.simulated, m.presence])).toEqual([
      ["Sam", true, "online"],
      ["Maya", true, "online"],
      ["Leo", true, "online"],
    ]);
    // The presenter's real phone joins like anyone else and becomes the default story subject.
    const y = (await call(`/api/groups/${code}/join`, "", setup("Yeyito"))).body as JoinResponse;
    const yp = phone(y);
    await until("phone connected", () => yp.view && stage.view?.members.length === 4);
    await call(`/api/groups/${code}/demo/timers`, stageKey, { timers: FAST });
    yp.send({ t: "signals", heartbeat: true, appState: "foreground", fix: { lat: 43.78446, lng: -79.18747, accuracy: 15 } });
    await call(`/api/groups/${code}/demo/reset`, stageKey, {}); // re-anchors the friends next to the phone

    // A simulated friend answers a check-in by itself.
    const maya = stage.view!.members.find((m) => m.name === "Maya")!;
    await call(`/api/groups/${code}/members/${maya.id}/checkins`, y.key, {});
    await until("Maya answered", () => stage.view?.members.find((m) => m.id === maya.id)?.lastCheckin?.outcome === "ok", 4000);

    // Storyline steps on the real phone (default subject), "friend" steps done by Sam.
    for (const s of STORY) {
      if (s.action === "checkin") continue; // live step: the presenter answers on the phone
      const r = await call(`/api/groups/${code}/demo/${s.action}`, stageKey, { delayMs: 0, wait: true, durationMs: 200 });
      expect(r.status).toBe(200);
      if (s.action === "slurred") await until("phone in alert", () => stage.view?.alerts[0]?.memberId === y.memberId);
      if (s.action === "slurred") await until("L3", () => stage.view?.alerts[0]?.stage === 3, 6000);
    }
    expect(stage.view?.alerts[0]?.stage).toBe(3); // the scripted story ends at the escalation
    // Still real features: a friend's "on my way" and "found & OK" (here via the demo actions, as Sam).
    expect((await call(`/api/groups/${code}/demo/ack`, stageKey, {})).status).toBe(200);
    expect((await call(`/api/groups/${code}/demo/resolve`, stageKey, {})).status).toBe(200);
    await until("resolved", () => stage.view?.alerts.length === 0);
    expect(stage.stages.get(y.memberId)).toEqual([0, 1, 2, 3, 0]);
    expect(stage.view!.events.some((e) => /Sam is on the way to Yeyito/.test(e.text))).toBe(true);
    expect(yp.of("alert").filter((a) => a.you).map((a) => a.alert.stage)).toEqual([1, 2, 3]);

    // Now a simulated friend is the one in trouble: the real phone gets the alert.
    await call(`/api/groups/${code}/demo/reset`, stageKey, {});
    await call(`/api/groups/${code}/demo/subject`, stageKey, { target: maya.id });
    await call(`/api/groups/${code}/demo/fall`, stageKey, {});
    await call(`/api/groups/${code}/demo/slurred`, stageKey, { delayMs: 0, wait: true });
    await until("phone alerted about Maya", () => yp.of("alert").some((a) => a.alert.memberId === maya.id && !a.you));
    expect((await call(`/api/groups/${code}/members/${maya.id}/ack`, y.key, {})).status).toBe(200);
    expect((await call(`/api/groups/${code}/members/${maya.id}/resolve`, y.key, {})).status).toBe(200);
    await until("Maya OK", () => stage.view?.alerts.length === 0);

    // The stage key can't act as a member, and members of other groups can't drive this one.
    expect((await call(`/api/groups/${code}/members/${maya.id}/ack`, stageKey, {})).status).toBe(403);
    await call(`/api/groups/${code}/end`, y.key, {});
    stage.ws.close();
    yp.ws.close();
  }, 20_000);

  test("demo controls are refused on a real (non-demo) group", async () => {
    const { code, joins } = await newGroup(["Maya", "Sam"], { demo: false });
    expect((await call(`/api/groups/${code}/demo/fall`, joins[0]!.key, {})).status).toBe(403);
    await call(`/api/groups/${code}/end`, joins[0]!.key, {});
  });

  test("demo pacing: a storyline check-in can't time out between clicker steps", () => {
    expect(DEMO_TIMERS.checkinTimeoutMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe("joining, auth, privacy, lifecycle", () => {
  test("validation, join links, preview, keys", async () => {
    expect((await call("/api/groups", "", { member: { name: "X", pin: "1234" } })).status).toBe(400); // no consent
    expect((await call("/api/groups", "", { member: { name: "X", pin: "12", consent: true } })).status).toBe(400);
    const { code, joins } = await newGroup(["Maya"], { demo: false, over: { shareLocation: "alert" } });
    const j = joins[0]!;
    expect(j.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(j.links.deepLink).toBe(`wingman://join/${code}`);
    expect(j.links.joinUrl).toEndWith(`/j/${code}`);
    expect(parseJoinLink(j.links.joinUrl)).toBe(code);
    expect(parseJoinLink(j.links.deepLink)).toBe(code);
    expect(j.wsPath).toBe(`/ws?g=${code}&m=${j.memberId}&k=${j.key}`);
    const page = await fetch(`${app.url}/j/${code}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`wingman://join/${code}`);
    expect((await fetch(`${app.url}/j/ZZZZZZ`)).status).toBe(404);
    const preview = await call(`/api/groups/${code}`, "");
    expect(preview.body.members).toEqual([{ name: "Maya", color: expect.any(String) }]);
    expect(JSON.stringify(preview.body)).not.toContain("penicillin");

    const sam = (await call(`/api/groups/${code}/join`, "", setup("Sam"))).body as JoinResponse;
    expect(sam.key).not.toBe(j.key);
    // Location only on alert.
    await call(`/api/groups/${code}/members/${j.memberId}/signals`, j.key, fixNear(0));
    let sv = (await call(`/api/groups/${code}/view`, sam.key)).body as GroupView;
    expect(sv.members.find((m) => m.id === j.memberId)!.fix).toBeNull();
    await call(`/api/groups/${code}/members/${j.memberId}/escalate`, sam.key, {});
    sv = (await call(`/api/groups/${code}/view`, sam.key)).body as GroupView;
    expect(sv.members.find((m) => m.id === j.memberId)!.fix).not.toBeNull();
    // Keys are enforced.
    expect((await call(`/api/groups/${code}/view`, "wrong")).status).toBe(403);
    expect((await call(`/api/groups/${code}/view`, "")).status).toBe(403);
    const bad = await fetch(`${app.url.replace("http", "ws")}/ws?g=${code}&m=${j.memberId}&k=nope`.replace("ws", "http"), { headers: { upgrade: "websocket" } });
    expect(bad.status).toBe(403);
    // Push token (no-op sender by default).
    expect((await call(`/api/groups/${code}/members/${sam.memberId}/push-token`, sam.key, { kind: "expo", token: "ExponentPushToken[abc]" })).status).toBe(200);
    sv = (await call(`/api/groups/${code}/view`, sam.key)).body as GroupView;
    expect(sv.members[0]!.hasPushToken).toBe(true);
    expect(sv.engines.push).toBe("none");
    // Leaving deletes just that member.
    expect((await call(`/api/groups/${code}/members/${sam.memberId}/leave`, sam.key, {})).status).toBe(200);
    expect((await call(`/api/groups/${code}/view`, sam.key)).status).toBe(403);
    const mv = (await call(`/api/groups/${code}/view`, j.key)).body as GroupView;
    expect(mv.members.map((m) => m.name)).toEqual(["Maya"]);
    await call(`/api/groups/${code}/end`, j.key, {});
  });

  test("dead-man's switch: a phone that dies counts; a phone that went to the background does not", async () => {
    const { code, joins } = await newGroup(["Maya", "Sam"]);
    const m = joins[0]!;
    await call(`/api/groups/${code}/demo/timers`, m.key, { timers: { heartbeatLostMs: 300 } });
    await call(`/api/groups/${code}/members/${m.memberId}/signals`, m.key, { heartbeat: true, appState: "foreground" });
    await Bun.sleep(450);
    let v = (await call(`/api/groups/${code}/view`, joins[1]!.key)).body as GroupView;
    let mm = v.members.find((x) => x.id === m.memberId)!;
    expect(mm.risk.reasons.map((x) => x.code)).toContain("offline");
    expect(mm.presence).toBe("silent");
    await call(`/api/groups/${code}/members/${m.memberId}/signals`, m.key, { appState: "locked" });
    await Bun.sleep(450);
    v = (await call(`/api/groups/${code}/view`, joins[1]!.key)).body as GroupView;
    mm = v.members.find((x) => x.id === m.memberId)!;
    expect(mm.presence).toBe("background");
    expect(mm.signals.appState).toBe("locked");
    expect(mm.risk.reasons.map((x) => x.code)).not.toContain("offline");
    await call(`/api/groups/${code}/end`, m.key, {});
  });
});
