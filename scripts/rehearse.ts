// Dress rehearsal: plays the stage storyline at real pitch pace (demo timers, pauses like a presenter talking).
// The stage view runs in headless Chromium driven by clicker keys; the presenter's phone is a protocol client over
// WebSocket (exactly what the iPhone app sends: signals, check-in answers, alerts); Sam/Maya/Leo are simulated.
//   bun run rehearse        (~2 min; uses the mock scorer, no API calls)

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../src/server/app.ts";
import type { GroupView, JoinResponse, ServerMsg } from "../src/shared/types.ts";

const chrome = (() => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = join(homedir(), ".cache/ms-playwright");
  for (const d of existsSync(root) ? readdirSync(root).sort().reverse() : []) {
    const p = join(root, d, "chrome-linux64/chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("set CHROMIUM_PATH");
})();

// REHEARSE_LIVE=1 uses the real scorer for step 1 (one API call); the scripted steps never call an API.
const app = startServer({ port: 0, engines: process.env.REHEARSE_LIVE === "1" ? undefined : ["mock"], quiet: true });
const browser = await chromium.launch({ executablePath: chrome, args: ["--autoplay-policy=no-user-gesture-required"] });
const t0 = Date.now();
const log = (m: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${m}`);
const errors: string[] = [];
const fail = (m: string) => {
  errors.push(m);
  log(`✗ ${m}`);
};

try {
  const post = (path: string, key: string, b: object = {}) =>
    fetch(app.url + path, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json() as any);
  const d = await post("/api/demo", "", { presenterName: "Yeyito" });
  const me: JoinResponse = await post(`/api/groups/${d.code}/join`, "", { name: "Yeyito", pin: "1234", consent: true, phone: "+14165550123", medical: "Allergic to penicillin.", emergencyContact: { name: "Mom", phone: "+14165550199" } });
  const view = async () => (await (await fetch(`${app.url}/api/groups/${d.code}/view`, { headers: { authorization: `Bearer ${me.key}` } })).json()) as GroupView;
  const mine = async () => (await view()).members[0]!;

  // The presenter's phone, speaking the app protocol.
  const msgs: ServerMsg[] = [];
  const ws = new WebSocket(`${app.url.replace("http", "ws")}${me.wsPath}`);
  ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
  await new Promise((r) => (ws.onopen = r));
  const beat = () => ws.send(JSON.stringify({ t: "signals", heartbeat: true, appState: "foreground", battery: 0.7, fix: { lat: 43.78446, lng: -79.18747, accuracy: 12 }, sensors: { motion: "on", location: "on", mic: "on" } }));
  beat();
  const hb = setInterval(beat, 5000);
  await post(`/api/groups/${d.code}/demo/reset`, d.stageKey); // friends stand next to the phone
  log("phone joined and heartbeating");

  const stage = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  stage.on("pageerror", (e) => fail(`stage JS: ${e.message}`));
  await stage.goto(`${app.url}/stage/${d.code}?k=${d.stageKey}`);
  await stage.waitForSelector(".mcard");
  await stage.mouse.click(640, 30); // arms sound (header, not a card or a dock button)
  log("stage view open (4 members)");

  const press = async (n: number, what: string) => {
    await stage.keyboard.press("ArrowRight");
    log(`clicker ${n}: ${what}`);
  };
  const expectStage = async (want: number, when: string) => {
    const m = await mine();
    const got = m.alert?.stage ?? 0;
    if (got !== want) fail(`${when}: expected stage ${want}, got ${got} (${m.risk.summary})`);
    else log(`  ok: stage ${got} · risk ${m.risk.score} · ${m.risk.summary}`);
    return m;
  };

  await press(1, "live check-in");
  const deadline = Date.now() + 5000;
  while (!msgs.some((m) => m.t === "checkin") && Date.now() < deadline) await stage.waitForTimeout(100);
  const ask = msgs.find((m) => m.t === "checkin") as Extract<ServerMsg, { t: "checkin" }> | undefined;
  if (!ask) fail("phone never got the check-in message");
  else {
    await stage.waitForTimeout(3000); // the phone speaks the question, the presenter answers
    const r = await post(`/api/groups/${d.code}/members/${me.memberId}/checkins/${ask.checkin.id}/answer`, me.key, { text: "I'm at Hack the Valley with my team." });
    log(`  phone answered → ${r.checkin?.outcome} [${r.checkin?.result?.engine}: ${r.checkin?.result?.reason}]`);
    if (r.checkin?.outcome !== "ok") fail("step-1 answer wasn't OK");
  }
  await stage.waitForTimeout(12_000); // presenter talks about it

  await press(2, "drift away");
  await stage.waitForTimeout(18_000);
  await expectStage(0, "after drifting away + 18 s of narration");

  await press(3, "fall");
  await stage.waitForTimeout(12_000);
  await expectStage(0, "after fall + 12 s of narration");

  await press(4, "slurred answer (clip plays aloud)");
  const tAlert = Date.now();
  await stage.waitForSelector(".st-alarm:not(.hidden)", { timeout: 20_000 });
  log(`  LEVEL 1 after ${((Date.now() - tAlert) / 1000).toFixed(1)} s: stage alarm takeover`);
  const v1 = await expectStage(1, "after slurred answer");
  for (const code of ["impaired_checkin", "fall", "away_from_group"]) if (!v1.risk.reasons.some((x) => x.code === code)) fail(`L1 reasons missing ${code}`);

  await stage.waitForFunction(() => document.querySelector(".ladder li.now")?.textContent?.includes("Bystander"), null, { timeout: 20_000 }).catch(() => fail("stage never showed L2"));
  log("  LEVEL 2: bystander mode on the phone");
  await stage.waitForSelector(".sms", { timeout: 20_000 }).catch(() => {});
  const v3 = await expectStage(3, "after L2 timer");
  const sms = (await view()).notifications.find((n) => n.aboutMemberId === me.memberId);
  if (!sms) fail("no level-3 notification");
  else log(`  LEVEL 3: ${sms.simulated ? "simulated" : "real"} SMS to ${sms.toName}`);
  void v3;

  await stage.waitForTimeout(5_000);
  await press(5, "Sam: I'm on my way");
  await stage.waitForSelector(".acks", { timeout: 5000 }).catch(() => fail("ack not shown on stage"));
  if (!msgs.some((m) => m.t === "ack" && m.you && m.ack.byName === "Sam")) await stage.waitForTimeout(500);
  if (!msgs.some((m) => m.t === "ack" && m.you && m.ack.byName === "Sam")) fail("phone didn't get Sam's ack");
  else log("  phone told: Sam is on the way");

  await stage.waitForTimeout(3_000);
  await press(6, "Sam: found & OK");
  await stage.waitForSelector(".st-alarm.hidden", { state: "attached", timeout: 5000 }).catch(() => fail("alarm didn't clear"));
  await expectStage(0, "after found & OK");
  const mineAlerts = msgs.filter((m) => m.t === "alert" && m.you).map((m) => (m as any).alert.stage);
  if (JSON.stringify(mineAlerts) !== "[1,2,3]") fail(`phone alert sequence ${JSON.stringify(mineAlerts)}`);
  else log("  phone saw alerts [1,2,3] and resolved");
  clearInterval(hb);
  ws.close();
} finally {
  await browser.close();
  app.stop();
}

if (errors.length) {
  console.error(`\nREHEARSAL FAILED (${errors.length}):\n - ${errors.join("\n - ")}`);
  process.exit(1);
}
console.log(`\nRehearsal OK: full storyline in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
