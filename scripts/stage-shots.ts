// Stage view screenshots for a real-world layout: the presenter's phone downtown (UofT St. George) joins a demo
// group created from the landing page, so the simulated friends start at the default venue (UTSC, ~30 km away).
//   bun scripts/stage-shots.ts [outDir]        (PHONE_ACC=1500 simulates iOS "approximate location")

import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { startServer } from "../src/server/app.ts";
import { findChromium } from "./chromium.ts";

const OUT = process.argv[2] ?? "/tmp/wingman-stage-shots";
mkdirSync(OUT, { recursive: true });
const GERSTEIN = { lat: 43.6623, lng: -79.3941 };
const ACC = Number(process.env.PHONE_ACC ?? 35);

const app = startServer({ port: 0, engines: ["mock"], quiet: true });
const browser = await chromium.launch({ executablePath: findChromium(), args: ["--autoplay-policy=no-user-gesture-required"] });
const errors: string[] = [];
const post = (path: string, key: string, body: object = {}) =>
  fetch(app.url + path, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as any);

try {
  const d = await post("/api/demo", "", {});
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(d.stageUrl.replace(/^https?:\/\/[^/]+/, app.url));
  await page.waitForSelector(".mcard");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/0-stage-before-phone.png` });

  const j = await post(`/api/groups/${d.code}/join`, "", { name: "Yeyito", pin: "1234", consent: true, medical: "No allergies.", emergencyContact: { name: "Mom", phone: "+1 416 555 0199" } });
  const beat = () => post(`/api/groups/${d.code}/members/${j.memberId}/signals`, j.key, { heartbeat: true, battery: 0.71, appState: "foreground", fix: { ...GERSTEIN, accuracy: ACC }, sensors: { motion: "on", location: "on", mic: "on", notifications: "on" } });
  await beat();
  const hb = setInterval(beat, 2000);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/1-stage-calm.png` });
  await page.mouse.click(640, 30);
  await page.keyboard.press("ArrowRight"); // check-in
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/2-stage-checkin.png` });
  await page.keyboard.press("ArrowRight"); // drift
  await page.waitForTimeout(8500);
  await page.keyboard.press("ArrowRight"); // fall
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/3-stage-watch.png` });
  await post(`/api/groups/${d.code}/demo/slurred`, d.stageKey, { delayMs: 0, wait: true });
  await page.waitForSelector(".st-alarm:not(.hidden)", { timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/4-stage-alert.png` });
  clearInterval(hb);
} finally {
  await browser.close();
  app.stop();
}
if (errors.length) console.error("page errors:\n" + errors.join("\n"));
console.log(`saved to ${OUT}`);
