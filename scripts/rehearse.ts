// Dress rehearsal: plays the on-stage storyline at real pitch pace (demo timers, pauses like a presenter
// talking) with a phone page and the stage view in headless Chromium, and checks the timeline.
//   bun run rehearse        (~2 min; uses the mock scorer, no API calls)

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../src/server/app.ts";
import type { SessionView } from "../src/shared/types.ts";

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
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const t0 = Date.now();
const log = (m: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${m}`);
const errors: string[] = [];
const fail = (m: string) => {
  errors.push(m);
  log(`✗ ${m}`);
};

try {
  const r = await (await fetch(`${app.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Yeyito", phone: "+14165550123", pin: "1234", medical: "Allergic to penicillin.", contactName: "Mom", contactPhone: "+14165550199", demo: true }) })).json();
  const view = async () => (await (await fetch(`${app.url}/api/s/${r.id}`, { headers: { "x-wingman-key": r.userKey } })).json()) as SessionView;

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 43.78446, longitude: -79.18747, accuracy: 20 }, permissions: ["geolocation", "microphone"] });
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => fail(`phone JS: ${e.message}`));
  await phone.goto(`${app.url}/me/${r.id}?k=${r.userKey}`);
  await phone.click("#armbtn");
  log("phone armed");

  const stage = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  stage.on("pageerror", (e) => fail(`stage JS: ${e.message}`));
  await stage.goto(`${app.url}/stage/${r.id}?k=${r.userKey}`);
  const frame = stage.frameLocator("#buddyframe");
  await frame.locator("#bname").fill("Sam");
  await frame.locator('button[type="submit"]').click();
  await frame.locator("#status .title").waitFor();
  await stage.locator("aside").click({ position: { x: 5, y: 5 } });
  log("stage view joined as Sam");

  const press = async (n: number, what: string) => {
    await stage.keyboard.press("ArrowRight");
    log(`clicker ${n}: ${what}`);
  };
  const expectStage = async (want: number, when: string) => {
    const v = await view();
    if (v.stage !== want) fail(`${when}: expected stage ${want}, got ${v.stage} (${v.risk.summary})`);
    else log(`  ok: stage ${v.stage} · risk ${v.risk.score} · ${v.risk.summary}`);
    return v;
  };

  await press(1, "live check-in");
  await phone.waitForSelector("#checkin-ov:not(.hidden)");
  // Headless Chromium's fake microphone plays a beep: it is recorded, converted to WAV and uploaded like real speech.
  // (A live AI correctly hears "no answer" in a beep; step 2 starts a fresh scene either way.)
  let first: SessionView["checkins"][number] | undefined;
  for (let i = 0; i < 120 && !(first?.status === "done"); i++) {
    await stage.waitForTimeout(250);
    first = (await view()).checkins[0];
  }
  if (first?.status !== "done") fail("step-1 check-in was never answered by the phone");
  else log(`  phone answered by voice → ${first.outcome} [${first.result?.engine}: ${first.result?.reason}]`);
  await stage.waitForTimeout(12_000); // presenter talks about it

  await press(2, "walk away");
  await stage.waitForTimeout(18_000);
  await expectStage(0, "after walking away + 18 s of narration");

  await press(3, "fall");
  await stage.waitForTimeout(12_000);
  await expectStage(0, "after fall + 12 s of narration");

  await press(4, "slurred answer (clip plays aloud)");
  const tAlert = Date.now();
  await frame.locator("#takeover:not(.hidden)").waitFor({ timeout: 20_000 });
  log(`  LEVEL 1 after ${((Date.now() - tAlert) / 1000).toFixed(1)} s`);
  const v1 = await expectStage(1, "after slurred answer");
  for (const code of ["impaired_checkin", "fall", "away_from_group"]) if (!v1.risk.reasons.some((x) => x.code === code)) fail(`L1 reasons missing ${code}`);

  await phone.waitForSelector("#bystander:not(.hidden)", { timeout: 20_000 });
  log("  LEVEL 2: bystander mode on the phone");
  await frame.locator(".rung.now", { hasText: "Level 3" }).waitFor({ timeout: 20_000 }).catch(() => {});
  const v3 = await expectStage(3, "after L2 timer");
  if (!v3.notifications.length) fail("no level-3 notification");
  else log(`  LEVEL 3: ${v3.notifications[0]!.simulated ? "simulated" : "real"} SMS to ${v3.notifications[0]!.toName}`);

  await stage.waitForTimeout(5_000);
  await press(5, "Sam: I'm on my way");
  await phone.waitForFunction(() => document.querySelector("#bystander")?.textContent?.includes("Sam is on the way"), null, { timeout: 5000 }).catch(() => fail("ack not shown on phone"));
  log("  phone shows: Sam is on the way");

  await stage.waitForTimeout(3_000);
  await phone.click("#imok");
  for (const k of "1234") await phone.click(`[data-k="${k}"]`);
  await phone.waitForSelector("#bystander.hidden", { state: "attached", timeout: 5000 }).catch(() => fail("bystander mode didn't clear after PIN"));
  await expectStage(0, "after PIN");
  log("resolved by PIN");
} finally {
  await browser.close();
  app.stop();
}

if (errors.length) {
  console.error(`\nREHEARSAL FAILED (${errors.length}):\n - ${errors.join("\n - ")}`);
  process.exit(1);
}
console.log(`\nRehearsal OK: full storyline in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
