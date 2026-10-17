// End-to-end: a real server, a simulated phone and a simulated buddy over HTTP + WebSocket,
// driving the on-stage storyline and asserting the escalation sequence.
// Uses the deterministic mock scorer so it never touches a rate-limited AI API.
// Set E2E_LIVE_AI=1 (with GEMINI_API_KEY or OPENAI_API_KEY) to also push one real voice clip through the live scorer.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server/app.ts";
import { availableEngines } from "../src/server/scorer.ts";
import type { SessionView } from "../src/shared/types.ts";

let app: ReturnType<typeof startServer>;

beforeAll(() => {
  app = startServer({ port: 0, engines: ["mock"], quiet: true, tickMs: 50 });
});
afterAll(() => app.stop());

const FAST = { l1ToL2Ms: 1500, l2ToL3Ms: 1500, checkinTimeoutMs: 5000, ackHoldMs: 60_000, probeCooldownMs: 300, fallConfirmMs: 500 };

async function call(path: string, key: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(app.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-wingman-key": key, ...(body instanceof Uint8Array ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

/** A WebSocket client that keeps the latest view and the history of escalation stages it saw. */
function client(sid: string, key: string, extra: Record<string, string> = {}) {
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/ws?${new URLSearchParams({ s: sid, k: key, ...extra })}`);
  const c = { ws, view: null as SessionView | null, stages: [] as number[], ended: false };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === "ended") c.ended = true;
    if (m.t !== "view") return;
    c.view = m.view;
    if (c.stages.at(-1) !== m.view.stage) c.stages.push(m.view.stage);
  };
  return c;
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

async function newSession(over: Record<string, unknown> = {}) {
  const r = await call("/api/sessions", "", {
    name: "Yeyito",
    phone: "+14165550123",
    pin: "1234",
    medical: "Allergic to penicillin",
    contactName: "Mom",
    contactPhone: "+14165550199",
    demo: true,
    ...over,
  });
  expect(r.status).toBe(200);
  const { id, userKey, inviteKey } = r.body;
  await call(`/api/s/${id}/settings`, userKey, { timers: FAST });
  return { id, userKey, inviteKey };
}

describe("end-to-end demo storyline", () => {
  test("walk away → fall → slurred check-in → L1 → L2 → L3 → buddy ack → PIN resolves → end deletes", async () => {
    const { id, userKey, inviteKey } = await newSession();
    const phone = client(id, userKey);
    await until("phone connected", () => phone.view);

    // The phone reports in.
    await call(`/api/s/${id}/signal`, userKey, { hb: true, battery: 81, motion: true, fix: { lat: 43.78446, lng: -79.18747, accuracy: 12 }, sensors: { motion: "on", location: "on", mic: "on" } });

    // A buddy joins from the share link.
    const join = await call(`/api/s/${id}/join`, inviteKey, { name: "Sam" });
    expect(join.status).toBe(200);
    const buddy = client(id, inviteKey, { b: join.body.buddyId });
    await until("buddy sees Sam online", () => buddy.view?.buddies.find((b) => b.name === "Sam" && b.online));
    expect(buddy.view!.user.medical).toBe(""); // medical info stays private until an alert
    expect(buddy.view!.inviteUrl).toBeUndefined();

    // 1. Baseline: a clear answer to a check-in keeps everything green.
    await call(`/api/s/${id}/demo/coherent`, userKey, { delayMs: 0, wait: true });
    const ok = await until("coherent check-in scored", () => phone.view?.checkins.find((c) => c.outcome === "ok"));
    expect(ok.result!.engine).toBe("mock");
    expect(phone.view!.stage).toBe(0);

    // 2. Walk away from the group: risk goes to "watch" and Wingman proactively asks a check-in.
    await call(`/api/s/${id}/demo/walk`, userKey, { durationMs: 300 });
    const probe = await until("suspicion check-in", () => phone.view?.checkin?.status === "pending" && phone.view.checkin);
    expect(probe.trigger).toBe("suspicion: away from group");
    expect(phone.view!.risk.reasons.map((r) => r.code)).toContain("away_from_group");
    expect(phone.view!.risk.level).toBe("watch");

    // 3. A fall, then a slurred answer: alert -> level 1, buddies see the reasons.
    await call(`/api/s/${id}/demo/fall`, userKey, {});
    await call(`/api/s/${id}/demo/slurred`, userKey, { delayMs: 0, wait: true });
    await until("level 1", () => buddy.view?.stage === 1);
    const codes = buddy.view!.risk.reasons.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["fall", "impaired_checkin", "away_from_group"]));
    expect(buddy.view!.risk.level).toBe("alert");
    expect(buddy.view!.risk.summary).toMatch(/^check-in answer sounded impaired: .+ \+ fall detected .+ \+ \d+ m from your group( \+ it.s \d AM)?$/);
    expect(buddy.view!.user.medical).toBe("Allergic to penicillin"); // shared once an alert fires
    expect(buddy.view!.fix).not.toBeNull();

    // 4. Nobody responds: bystander mode on the phone, then the emergency contact.
    await until("level 2 (bystander)", () => phone.view?.stage === 2, 4000);
    await until("level 3 (contact notified)", () => phone.view?.stage === 3 && phone.view.notifications.length > 0, 4000);
    const sms = phone.view!.notifications[0]!;
    expect(sms.simulated).toBe(true);
    expect(sms.to).toBe("+14165550199");
    expect(sms.body).toContain("Yeyito may need help");
    expect(sms.body).toContain("maps.google.com");

    // 5. Buddy: "I'm on my way" is visible to everyone.
    await call(`/api/s/${id}/buddy/ack`, inviteKey, { buddyId: join.body.buddyId });
    await until("ack visible on phone", () => phone.view?.acks.some((a) => a.name === "Sam"));

    // 6. A confused person can't dismiss it: wrong PIN is rejected; the right one resolves.
    expect((await call(`/api/s/${id}/pin`, userKey, { pin: "0000" })).status).toBe(401);
    expect(phone.view!.stage).toBe(3);
    expect((await call(`/api/s/${id}/pin`, inviteKey, { pin: "1234" })).status).toBe(403); // buddies can't cancel
    expect((await call(`/api/s/${id}/pin`, userKey, { pin: "1234" })).status).toBe(200);
    await until("resolved on buddy screen", () => buddy.view?.stage === 0);
    expect(buddy.stages).toEqual([0, 1, 2, 3, 0]);
    expect(phone.view!.risk.level).toBe("ok");
    expect(phone.view!.events.some((e) => e.text.includes(`Resolved by Yeyito (PIN "I'm OK")`))).toBe(true);

    // The log the buddies see tells the whole story, in order.
    const log = buddy.view!.events.map((e) => e.text);
    const order = ["walking away", "Possible fall", "sounded impaired", "LEVEL 1", "LEVEL 2", "LEVEL 3", "Sam is on the way", "Resolved by"];
    const idx = order.map((needle) => log.findIndex((t) => t.includes(needle)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);

    // 7. Ending the night deletes everything and kicks the buddy out.
    expect((await call(`/api/s/${id}/end`, userKey, {})).status).toBe(200);
    await until("buddy told the session ended", () => buddy.ended);
    expect((await call(`/api/s/${id}`, userKey)).status).toBe(404);
    phone.ws.close();
    buddy.ws.close();
  }, 20_000);

  test("missed check-in after a fall escalates; a coherent reply de-escalates", async () => {
    const { id, userKey, inviteKey } = await newSession();
    const phone = client(id, userKey);
    await until("connected", () => phone.view);
    await call(`/api/s/${id}/demo/fall`, userKey, {});
    const c = await until("fall triggers a check-in", () => phone.view?.checkin);
    expect(c.trigger).toBe("suspicion: fall");
    await call(`/api/s/${id}/demo/miss`, userKey, { afterMs: 0 });
    await until("level 1 after miss", () => phone.view?.stage === 1);
    expect(phone.view!.risk.summary).toMatch(/^missed a check-in \+ fall detected/);
    // Level 1 asks the person directly; a clear answer clears the alert.
    await until("alert check-in", () => phone.view?.checkin?.trigger === "alert");
    await call(`/api/s/${id}/demo/coherent`, userKey, { delayMs: 0, wait: true });
    await until("back to monitoring", () => phone.view?.stage === 0);
    expect(phone.view!.risk.level).toBe("ok");
    expect((await call(`/api/s/${id}/demo/reset`, userKey, {})).status).toBe(200);
    await call(`/api/s/${id}/end`, userKey, {});
    phone.ws.close();
    void inviteKey;
  }, 15_000);

  test("a real voice reply (WAV upload) goes through the scoring pipeline", async () => {
    const { id, userKey } = await newSession();
    const phone = client(id, userKey);
    await until("connected", () => phone.view);
    const asked = await call(`/api/s/${id}/checkin`, userKey, {});
    const wav = new Uint8Array(await Bun.file("public/demo-audio/coherent.wav").arrayBuffer());
    const r = await call(`/api/s/${id}/checkin/${asked.body.checkin.id}/answer`, userKey, wav, { "content-type": "audio/wav" });
    expect(r.status).toBe(200);
    expect(r.body.checkin.outcome).toBe("ok");
    // Answering twice is rejected.
    expect((await call(`/api/s/${id}/checkin/${asked.body.checkin.id}/answer`, userKey, { text: "again" })).status).toBe(409);
    await call(`/api/s/${id}/end`, userKey, {});
    phone.ws.close();
  });

  test("privacy: with 'only on alert' sharing, buddies can't see location until an alert", async () => {
    const { id, userKey, inviteKey } = await newSession({ shareLocation: "alert" });
    await call(`/api/s/${id}/signal`, userKey, { hb: true, fix: { lat: 43.78446, lng: -79.18747, accuracy: 10 } });
    const before = await call(`/api/s/${id}`, inviteKey);
    expect(before.body.fix).toBeNull();
    expect(before.body.user.contactPhone).toBe("+•••••••••99");
    const join = await call(`/api/s/${id}/join`, inviteKey, { name: "Priya" });
    await call(`/api/s/${id}/buddy/escalate`, inviteKey, { buddyId: join.body.buddyId });
    const after = await call(`/api/s/${id}`, inviteKey);
    expect(after.body.stage).toBe(1);
    expect(after.body.fix).not.toBeNull();
    // Keys are enforced.
    expect((await call(`/api/s/${id}`, "wrong")).status).toBe(403);
    expect((await call(`/api/s/${id}/demo/fall`, inviteKey, {})).status).toBe(403);
    await call(`/api/s/${id}/end`, userKey, {});
  });

  const live = process.env.E2E_LIVE_AI === "1" && availableEngines()[0] !== "mock";
  test.skipIf(!live)("live AI scores the canned slurred clip as impaired (one API call)", async () => {
    const live = startServer({ port: 0, quiet: true });
    try {
      const r = await fetch(`${live.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Yeyito", pin: "1234", demo: true }) });
      const { id, userKey } = (await r.json()) as any;
      await fetch(`${live.url}/api/s/${id}/settings`, { method: "POST", headers: { "x-wingman-key": userKey, "content-type": "application/json" }, body: JSON.stringify({ demoAnswerMode: "live" }) });
      await fetch(`${live.url}/api/s/${id}/demo/slurred`, { method: "POST", headers: { "x-wingman-key": userKey, "content-type": "application/json" }, body: JSON.stringify({ delayMs: 0, wait: true }) });
      const v = (await (await fetch(`${live.url}/api/s/${id}`, { headers: { "x-wingman-key": userKey } })).json()) as SessionView;
      const c = v.checkins.find((x) => x.result)!;
      console.log(`[live AI] ${c.result?.engine} ${c.result?.model} ${c.result?.latencyMs} ms: ${c.result?.reason}`);
      expect(c.result?.engine).not.toBe("mock");
      expect(c.outcome).toBe("impaired");
    } finally {
      live.stop();
    }
  }, 30_000);
});
