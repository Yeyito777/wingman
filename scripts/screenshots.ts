// Drives the stage view (projector) and the web fallback (phone viewport) in headless Chromium through the group
// storyline and saves screenshots to docs/screenshots/. Fails on any page JS error or layout-guard problem.
//   bun run screenshots            (uses Playwright's cached Chromium, or set CHROMIUM_PATH)

import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { startServer } from "../src/server/app.ts";
import { findChromium } from "./chromium.ts";

const OUT = process.env.SHOTS_OUT ?? "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const app = startServer({ port: 0, engines: ["mock"], quiet: true });
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const errors: string[] = [];
const VENUE = { latitude: 43.78446, longitude: -79.18747, accuracy: 15 };

async function phoneContext() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: VENUE,
    permissions: ["geolocation", "microphone"],
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/tile|cartocdn|favicon|ERR_|net::/i.test(m.text()) && errors.push(`${page.url()}: console ${m.text()}`));
  return page;
}

/**
 * Layout guards:
 *  - nothing may scroll sideways (page or the alarm takeover);
 *  - on the visible alarm takeover, its headline, reasons, ladder and acks must be the topmost element at sampled
 *    points, so no map pane/control can float over them;
 *  - headlines must not be clipped.
 */
async function layoutProblems(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(() => {
        const problems: string[] = [];
        const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
        for (const el of [document.documentElement, ...document.querySelectorAll<HTMLElement>(".st-alarm:not(.hidden)")]) {
          if (el.scrollWidth > el.clientWidth + 1) problems.push(`horizontal overflow ${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
        }
        // Hit-testing skips pointer-events:none layers (Leaflet tiles!), so force them on to match paint order.
        const force = document.createElement("style");
        force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
        document.head.append(force);
        for (const ov of document.querySelectorAll<HTMLElement>(".st-alarm:not(.hidden)")) {
          const targets = ov.querySelectorAll<HTMLElement>(".al-title, .chip, .ladder li, .acks, .sms, button, a.btn");
          for (const t of targets) {
            const r = t.getBoundingClientRect();
            if (r.width < 4 || r.height < 4 || getComputedStyle(t).visibility === "hidden") continue;
            // 7x3 grid of sample points across the element (inset 4 px from the border).
            const pts: [number, number][] = [];
            for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) pts.push([r.left + 4 + ((r.width - 8) * i) / 6, r.top + 4 + ((r.height - 8) * j) / 2]);
            for (const [x, y] of pts) {
              if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; // scrolled out of view
              const hit = document.elementFromPoint(x, y);
                  if (hit && !t.contains(hit) && !hit.contains(t)) {
                problems.push(`${label(hit)} covers ${label(t)} "${(t.textContent ?? "").trim().slice(0, 30)}" at ${Math.round(x)},${Math.round(y)}`);
                break;
              }
            }
          }
          for (const h of ov.querySelectorAll<HTMLElement>(".al-title")) {
            if (h.scrollWidth > h.clientWidth + 1) problems.push(`headline clipped ${label(h)} ${h.scrollWidth}>${h.clientWidth}`);
          }
        }
        force.remove();
        return problems;
      })
      .catch((e) => [`guard failed to run: ${String(e?.message ?? e).slice(0, 200)}`]);
    out.push(...found.map((p) => (frame === page.mainFrame() ? p : `[iframe] ${p}`)));
  }
  return out;
}

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(500);
  const problems = await layoutProblems(page);
  if (problems.length) errors.push(...problems.map((p) => `${name}: ${p}`));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  saved ${OUT}/${name}.png`);
};
const post = (path: string, key: string, body: object = {}) =>
  fetch(app.url + path, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as any);

try {
  // A demo group (Sam, Maya, Leo simulated) and the presenter's phone joining through the web fallback.
  const d = await post("/api/demo", "", { presenterName: "Yeyito" });
  const demo = (action: string, body: object = {}) => post(`/api/groups/${d.code}/demo/${action}`, d.stageKey, body);
  await demo("timers", { timers: { l1ToL2Ms: 6000, l2ToL3Ms: 4000 } });

  const phone = await phoneContext();
  await phone.goto(`${app.url}/`);
  await shot(phone, "01-web-landing");
  await phone.goto(`${app.url}/g/${d.code}`);
  await phone.fill('input[name="name"]', "Yeyito");
  await phone.fill('input[name="pin"]', "1234");
  await phone.fill('input[name="phone"]', "+1 416 555 0123");
  await phone.fill('input[name="medical"]', "Allergic to penicillin. Asthma: inhaler in left jacket pocket.");
  await phone.fill('input[name="cname"]', "Mom");
  await phone.fill('input[name="cphone"]', "+1 416 555 0199");
  await phone.check('input[name="consent"]');
  await shot(phone, "02-web-join");
  await phone.click('button:has-text("Join")');
  await phone.waitForSelector("#members .row");
  await phone.waitForTimeout(5500); // first heartbeat with a GPS fix
  await demo("reset"); // re-anchors the simulated friends next to the phone

  // Stage view, projector 1280x720, driven by clicker keys.
  const stage = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, geolocation: VENUE, permissions: ["geolocation"] })).newPage();
  stage.on("pageerror", (e) => errors.push(`stage: ${e.message}`));
  await stage.goto(d.stageUrl.replace(/^https?:\/\/[^/]+/, app.url));
  await stage.waitForSelector(".mcard");
  await stage.waitForTimeout(1500);
  await stage.mouse.click(640, 30); // arms sound (header, not a card or a dock button)
  await shot(stage, "03-stage-calm");
  await stage.keyboard.press("ArrowRight"); // live check-in on the phone (left pending)
  await phone.waitForSelector("#ans", { timeout: 5000 });
  await shot(phone, "04-web-checkin");
  await stage.keyboard.press("ArrowRight"); // drift away (8 s walk)
  await stage.waitForTimeout(8500);
  await stage.keyboard.press("PageDown"); // fall
  await stage.waitForTimeout(800);
  await shot(stage, "05-stage-watch");
  await stage.keyboard.press(" "); // slurred answer: clip plays aloud, answer lands as it ends
  await stage.waitForSelector(".st-alarm:not(.hidden)", { timeout: 16000 });
  await shot(stage, "06-stage-alert-l1");
  await phone.waitForSelector("#pinok", { timeout: 9000 });
  await phone.waitForSelector("text=THIS PERSON MAY NEED HELP", { timeout: 9000 });
  await shot(phone, "07-web-bystander");
  await stage.waitForFunction(() => document.querySelector(".ladder li.now")?.textContent?.includes("Emergency"), null, { timeout: 9000 });
  await stage.waitForSelector(".sms", { timeout: 4000 });
  await shot(stage, "08-stage-alert-l3");
  await stage.keyboard.press("ArrowRight"); // Sam: on my way
  await stage.waitForSelector(".acks", { timeout: 4000 });
  await shot(stage, "09-stage-ack");
  await stage.keyboard.press("ArrowRight"); // Sam: found & OK
  await stage.waitForSelector(".st-alarm.hidden", { state: "attached", timeout: 4000 });
  await shot(stage, "10-stage-resolved");

  // Now a simulated friend is in trouble: the phone is the guardian.
  await demo("reset");
  await stage.click('.mcard:has-text("Maya")'); // the stage makes Maya the story subject
  await stage.waitForTimeout(300);
  await demo("fall");
  await demo("slurred", { delayMs: 0, wait: true });
  await phone.waitForSelector("[data-ack]", { timeout: 6000 });
  await shot(phone, "11-web-friend-alert");
  await stage.setViewportSize({ width: 1920, height: 1080 });
  await stage.waitForTimeout(1200);
  await shot(stage, "12-stage-1080p-alert");
  await phone.click("[data-ack]");
  await stage.waitForSelector(".acks", { timeout: 4000 });
  await phone.click("[data-found]");
  await stage.waitForSelector(".st-alarm.hidden", { state: "attached", timeout: 4000 });
} finally {
  await browser.close();
  app.stop();
}

if (errors.length) {
  console.error("\nPage errors:\n" + [...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("\nAll screenshots captured with no page errors.");
