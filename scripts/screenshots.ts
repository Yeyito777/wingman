// Drives the real UI in headless Chromium (phone + buddy + demo panel, mobile viewports) through the
// demo storyline and saves screenshots to docs/screenshots/. Also fails on any page JS error.
//   bun run screenshots            (uses Playwright's cached Chromium, or set CHROMIUM_PATH)

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { startServer } from "../src/server/app.ts";

const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

function findChromium(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = join(homedir(), ".cache/ms-playwright");
  for (const dir of existsSync(root) ? readdirSync(root).sort().reverse() : []) {
    for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
      const p = join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error("No Chromium found: install one with `bunx playwright install chromium` or set CHROMIUM_PATH");
}

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
 * Layout guards, run in every frame (the stage view embeds the buddy page in an iframe):
 *  - nothing may scroll sideways (page or any visible overlay);
 *  - on a visible full-screen overlay (alarm takeover, bystander mode, check-in), its headline, reasons and buttons
 *    must be the topmost element at sampled points, so no map/pane/control can float over them;
 *  - headlines must not be clipped.
 */
async function layoutProblems(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(() => {
        const problems: string[] = [];
        const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
        for (const el of [document.documentElement, ...document.querySelectorAll<HTMLElement>(".overlay:not(.hidden)")]) {
          if (el.scrollWidth > el.clientWidth + 1) problems.push(`horizontal overflow ${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
        }
        // Hit-testing skips pointer-events:none layers (Leaflet tiles!), so force them on to match paint order.
        const force = document.createElement("style");
        force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
        document.head.append(force);
        for (const ov of document.querySelectorAll<HTMLElement>(".overlay:not(.hidden)")) {
          const targets = ov.querySelectorAll<HTMLElement>(".big, .warn, .q, .reasons li, .call911, .verdict, button, a.btn");
          for (const t of targets) {
            const r = t.getBoundingClientRect();
            if (r.width < 4 || r.height < 4 || getComputedStyle(t).visibility === "hidden") continue;
            // 7x3 grid of sample points across the element (inset 4 px from the border).
            const pts: [number, number][] = [];
            for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) pts.push([r.left + 4 + ((r.width - 8) * i) / 6, r.top + 4 + ((r.height - 8) * j) / 2]);
            for (const [x, y] of pts) {
              if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; // scrolled out of view
              const hit = document.elementFromPoint(x, y);
              if (hit?.closest(".modal")) continue; // an intentional dialog (PIN pad) on top is fine
              if (hit && !t.contains(hit) && !hit.contains(t)) {
                problems.push(`${label(hit)} covers ${label(t)} "${(t.textContent ?? "").trim().slice(0, 30)}" at ${Math.round(x)},${Math.round(y)}`);
                break;
              }
            }
          }
          for (const h of ov.querySelectorAll<HTMLElement>(".big, .warn")) {
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
  await page.waitForTimeout(400);
  const problems = await layoutProblems(page);
  if (problems.length) errors.push(...problems.map((p) => `${name}: ${p}`));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  saved ${OUT}/${name}.png`);
};
const demo = (id: string, key: string, action: string, body: object = {}) =>
  fetch(`${app.url}/api/s/${id}/demo/${action}`, { method: "POST", headers: { "x-wingman-key": key, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

try {
  // 1. Setup / consent screen
  const phone = await phoneContext();
  await phone.goto(`${app.url}/?demo=1`);
  await phone.fill("#name", "Yeyito");
  await phone.fill("#phone", "+1 416 555 0123");
  await phone.fill("#pin", "1234");
  await phone.fill("#medical", "Allergic to penicillin. Asthma: inhaler in left jacket pocket. Blood type O+.");
  await phone.fill("#contactName", "Mom");
  await phone.fill("#contactPhone", "+1 416 555 0199");
  await shot(phone, "01-phone-setup");

  // 2. Start the night (consent) -> dashboard
  await phone.check('input[name="consent"]');
  await phone.click('button[type="submit"]');
  await phone.waitForURL(/\/me\//);
  await phone.waitForSelector("#hero .title");
  const id = phone.url().split("/me/")[1]!.split(/[?#]/)[0]!;
  const saved = await phone.evaluate(() => JSON.parse(localStorage.getItem("wingman.session")!));
  const key: string = saved.key;
  await demo(id, key, "reset");
  await fetch(`${app.url}/api/s/${id}/settings`, { method: "POST", headers: { "x-wingman-key": key, "content-type": "application/json" }, body: JSON.stringify({ timers: { l1ToL2Ms: 6000, l2ToL3Ms: 4000 } }) });

  // 3. Buddy joins via the invite link
  const view = await (await fetch(`${app.url}/api/s/${id}`, { headers: { "x-wingman-key": key } })).json();
  const buddy = await phoneContext();
  await buddy.goto(view.inviteUrl.replace(/^https?:\/\/[^/]+/, app.url));
  await buddy.waitForSelector("#bname");
  await shot(buddy, "02-buddy-join");
  await buddy.fill("#bname", "Sam");
  await buddy.click('button[type="submit"]');
  await buddy.waitForSelector("#status .title");
  await phone.waitForTimeout(800);
  await shot(phone, "03-phone-dashboard");
  await shot(buddy, "04-buddy-ok");

  // 4. Demo panel (mobile and desktop)
  const panel = await phoneContext();
  await panel.goto(`${app.url}/demo/${id}?k=${key}`);
  await panel.waitForSelector("#state h2");
  await shot(panel, "05-demo-panel-mobile");
  await panel.setViewportSize({ width: 1280, height: 860 });
  await panel.waitForTimeout(300);
  await panel.evaluate(() => ((document.querySelector("#cols") as HTMLElement).style.gridTemplateColumns = "minmax(0,1.1fr) minmax(0,1fr)"));

  // 5. Walk away + fall -> the phone asks an AI check-in
  await demo(id, key, "walk", { durationMs: 1500 });
  await phone.waitForTimeout(1800);
  await demo(id, key, "fall");
  await phone.waitForSelector("#checkin-ov:not(.hidden)", { timeout: 5000 });
  await phone.waitForTimeout(1500);
  await shot(phone, "06-phone-checkin");
  await shot(buddy, "07-buddy-watch");
  await buddy.evaluate(() => document.querySelector("#map")?.scrollIntoView({ block: "center" }));
  await buddy.waitForTimeout(1500);
  await shot(buddy, "07b-buddy-map");
  await buddy.evaluate(() => scrollTo(0, 0));

  // 6. Slurred answer -> level 1: buddy alarm takeover
  await demo(id, key, "slurred", { delayMs: 0, wait: true });
  await buddy.waitForSelector("#takeover:not(.hidden)", { timeout: 5000 });
  await shot(buddy, "08-buddy-alert-takeover");
  await panel.waitForTimeout(300);
  await shot(panel, "09-demo-panel-desktop");

  // 7. Level 2: bystander mode on the phone (screenshot both flash phases)
  await phone.waitForSelector("#bystander:not(.hidden)", { timeout: 9000 });
  await phone.evaluate(() => ((document.querySelector("#bystander") as HTMLElement).style.animationPlayState = "paused"));
  await shot(phone, "10-phone-bystander");

  // 8. Level 3: emergency contact (simulated SMS) on the buddy dashboard
  await buddy.waitForFunction(() => document.querySelector(".rung.now")?.textContent?.includes("Level 3"), null, { timeout: 9000 }).catch(() => {});
  await buddy.click("#tclose").catch(() => {});
  await buddy.waitForTimeout(500);
  await shot(buddy, "11-buddy-dashboard-l3");
  await buddy.evaluate(() => document.querySelector("#sms")?.scrollIntoView({ block: "center" }));
  await shot(buddy, "12-buddy-sms-and-log");

  // 9. Buddy acks, then the PIN pad resolves it
  await buddy.evaluate(() => scrollTo(0, 0));
  await buddy.click("#ack");
  await phone.click("#imok");
  await phone.click('[data-k="1"]');
  await phone.click('[data-k="2"]');
  await shot(phone, "13-phone-pin");
  await phone.click('[data-k="3"]');
  await phone.click('[data-k="4"]');
  await buddy.waitForFunction(() => !document.querySelector("#status")?.className.includes("alert"), null, { timeout: 5000 });
  await phone.waitForTimeout(600);
  await shot(phone, "14-phone-resolved");
  await shot(buddy, "15-buddy-resolved");

  // 10. Stage view (projector, 1280x720) driven by clicker keys: a fresh stage-demo session.
  const r = await (await fetch(`${app.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Yeyito", phone: "+14165550123", pin: "1234", medical: "Allergic to penicillin. Asthma: inhaler in left jacket pocket.", contactName: "Mom", contactPhone: "+14165550199", demo: true }) })).json();
  const stagePage = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })).newPage();
  stagePage.on("pageerror", (e) => errors.push(`stage: ${e.message}`));
  await stagePage.goto(`${app.url}/stage/${r.id}?k=${r.userKey}`);
  const frame = stagePage.frameLocator("#buddyframe");
  await frame.locator("#bname").fill("Sam");
  await frame.locator('button[type="submit"]').click();
  await frame.locator("#status .title").waitFor();
  await stagePage.locator("aside").click({ position: { x: 5, y: 5 } });
  await stagePage.keyboard.press("ArrowRight"); // live check-in (left pending)
  await stagePage.keyboard.press("ArrowRight"); // new scene + walk away
  await stagePage.waitForTimeout(1200);
  await stagePage.keyboard.press("PageDown"); // fall
  await stagePage.waitForTimeout(300);
  await stagePage.keyboard.press(" "); // slurred answer: clip plays aloud, answer lands as it ends
  await frame.locator("#takeover:not(.hidden)").waitFor({ timeout: 16000 });
  await stagePage.waitForTimeout(500);
  await shot(stagePage, "16-stage-view-alert");
  await frame.locator("#tclose").click();
  await stagePage.waitForTimeout(2500);
  await shot(stagePage, "17-stage-view-dashboard");

  // 11. Projector at 1080p: escalate to level 2 so the takeover returns, and check it again at full width.
  await stagePage.setViewportSize({ width: 1920, height: 1080 });
  await fetch(`${app.url}/api/s/${r.id}/demo/escalate`, { method: "POST", headers: { "x-wingman-key": r.userKey, "content-type": "application/json" }, body: "{}" });
  await frame.locator("#takeover:not(.hidden)").waitFor({ timeout: 5000 });
  await stagePage.waitForTimeout(800);
  await shot(stagePage, "18-stage-view-1080p-alert");
} finally {
  await browser.close();
  app.stop();
}

if (errors.length) {
  console.error("\nPage errors:\n" + [...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("\nAll screenshots captured with no page errors.");
