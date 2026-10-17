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

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  // Layout guard: nothing may scroll sideways (page or any visible overlay).
  const overflow = await page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll<HTMLElement>(".overlay:not(.hidden)")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.id || el.tagName} ${el.scrollWidth}>${el.clientWidth}`),
  );
  if (overflow.length) errors.push(`${name}: horizontal overflow ${overflow.join(", ")}`);
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
} finally {
  await browser.close();
  app.stop();
}

if (errors.length) {
  console.error("\nPage errors:\n" + [...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("\nAll screenshots captured with no page errors.");
