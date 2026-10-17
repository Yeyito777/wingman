/// <reference types="bun" />
// Keyboard avoidance check for every screen with a text field, on the web build at iPhone 13 size (390×844).
// A simulated keyboard covers the bottom KB pt (336 pt keyboard incl. QuickType + 44 pt margin, + 47 pt for the
// iPhone's top safe-area inset that the web preview doesn't have). For each screen: the primary button and the focused
// field must be fully above it. Screenshots (keyboard drawn grey) go to SHOTS_OUT (default /tmp/wingman-keyboard).
// Usage: npx expo export --platform web --output-dir dist && bun tools/keyboard.ts

import { chromium, type Locator, type Page } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const KB = 336 + 44 + 47;
const root = new URL("../", import.meta.url).pathname;
const dist = root + "dist/";
const out = (process.env.SHOTS_OUT ?? "/tmp/wingman-keyboard").replace(/\/?$/, "/");
mkdirSync(out, { recursive: true });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const f = Bun.file(dist + p.replace(/^\/+/, ""));
    if (p !== "/" && (await f.exists())) return new Response(f);
    return new Response(Bun.file(dist + "index.html"), { headers: { "content-type": "text/html" } });
  },
});
const base = `http://localhost:${server.port}`;

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const dir = `${homedir()}/.cache/ms-playwright`;
  for (const d of readdirSync(dir).filter((x) => x.startsWith("chromium_headless_shell")).sort().reverse()) {
    const p = `${dir}/${d}/chrome-headless-shell-linux64/chrome-headless-shell`;
    if (existsSync(p)) return p;
  }
  throw new Error("no chromium found; set CHROME");
}

const browser = await chromium.launch({ executablePath: chromePath() });
const problems: string[] = [];

async function fresh(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(String(e)));
  return page;
}

const click = (page: Page, text: string) => page.getByText(text, { exact: true }).first().click();

/** Show the keyboard, check `musts` (and the focused element) are above it, screenshot, hide it. */
async function check(page: Page, name: string, musts: Locator[]) {
  await page.evaluate((h) => (window as any).__wingman.keyboard(h), KB);
  await page.waitForTimeout(700); // padding + reveal-focused scroll
  const limit = 844 - KB;
  for (const [i, l] of musts.entries()) {
    const b = await l.boundingBox();
    if (!b) problems.push(`${name}: required element #${i} not found`);
    else if (b.y < 0 || b.y + b.height > limit + 0.5) problems.push(`${name}: element #${i} at ${Math.round(b.y)}–${Math.round(b.y + b.height)} is not fully above the keyboard (top ${limit})`);
  }
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el.getAttribute("aria-hidden") || getComputedStyle(el).opacity === "0") return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 2) return null;
    // Not covered by anything else (e.g. the sticky footer): hit-test points across its top and bottom edges.
    let covered = false;
    for (const fy of [r.top + 3, Math.min(r.bottom - 3, r.top + 40)])
      for (const fx of [r.left + 8, r.left + r.width / 2, r.right - 8]) {
        const hit = document.elementFromPoint(fx, fy);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) covered = true;
      }
    return { y: r.y, h: r.height, tag: el.tagName, covered };
  });
  if (focused && (focused.y < 0 || focused.y + focused.h > limit + 0.5)) problems.push(`${name}: focused ${focused.tag} at ${Math.round(focused.y)}–${Math.round(focused.y + focused.h)} is hidden by the keyboard (top ${limit})`);
  if (focused?.covered) problems.push(`${name}: focused ${focused.tag} is covered by another element (the footer?)`);
  await page.evaluate((h) => {
    const d = document.createElement("div");
    d.id = "fake-kb";
    d.textContent = "keyboard";
    d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${h}px;background:rgba(120,120,128,.55);color:#fff;font:600 14px system-ui;display:grid;place-items:center;z-index:99999;pointer-events:none`;
    document.body.appendChild(d);
  }, KB);
  await page.screenshot({ path: `${out}${name}.png` });
  await page.evaluate(() => document.getElementById("fake-kb")?.remove());
  await page.evaluate(() => (window as any).__wingman.keyboard(null));
  await page.waitForTimeout(300);
  console.log(`⌨  ${name}`);
}

// --- onboarding: name (+ phone), medical, contact; then join
{
  const p = await fresh();
  await p.goto(base + "/");
  await p.waitForFunction(() => (window as any).__wingman);
  await click(p, "Get started");
  await p.getByTestId("name-input").click();
  await check(p, "kb-01-name", [p.getByTestId("continue"), p.getByTestId("name-input")]);
  await p.getByTestId("name-input").fill("Yeyito");
  await p.getByPlaceholder("Your number (optional)").click();
  await check(p, "kb-02-name-phone", [p.getByTestId("continue"), p.getByPlaceholder("Your number (optional)")]);
  await click(p, "Continue");
  for (const d of "1234") await p.getByRole("button", { name: d, exact: true }).click();
  await p.waitForTimeout(400);
  for (const d of "1234") await p.getByRole("button", { name: d, exact: true }).click();
  await p.waitForTimeout(600);
  await p.locator("textarea").click();
  await check(p, "kb-03-medical", [p.getByTestId("continue"), p.getByText("Skip", { exact: true }), p.locator("textarea")]);
  await p.locator("textarea").fill("Allergic to penicillin. Asthma, inhaler in left jacket pocket.");
  await click(p, "Continue");
  await p.getByPlaceholder("Name (e.g. Mom)").click();
  await check(p, "kb-04-contact-name", [p.getByTestId("continue"), p.getByPlaceholder("Name (e.g. Mom)")]);
  await p.getByPlaceholder("Phone number").click();
  await check(p, "kb-05-contact-phone", [p.getByTestId("continue"), p.getByText("Skip", { exact: true }), p.getByPlaceholder("Phone number")]);
  await click(p, "Continue");
  for (let i = 0; i < 5; i++) await click(p, "Not now").catch(() => {});
  await click(p, "Join with code");
  await p.getByTestId("code-input").fill("K7Q2");
  await check(p, "kb-06-join", [p.getByTestId("join-submit"), p.getByTestId("code-boxes")]);
  await p.context().close();
}

// --- in a group (mock server): check-in "Type instead", settings
async function inGroup(scene?: string) {
  const p = await fresh();
  await p.goto(base + "/");
  await p.waitForFunction(() => (window as any).__wingman);
  await p.getByText("Get started").waitFor();
  await p.evaluate(async () => {
    await (window as any).__wingman.mockNight();
    (window as any).__wingman.router.replace("/group");
  });
  await p.waitForTimeout(600);
  if (scene) await p.evaluate((s) => (window as any).__wingman.scene(s), scene);
  return p;
}
{
  const p = await inGroup("checkin");
  await p.waitForTimeout(1500);
  await click(p, "Type instead");
  await p.locator("textarea").fill("At the Rex on Queen with Sam and Maya");
  await check(p, "kb-07-checkin-typed", [p.getByText("Send", { exact: true }), p.getByText("Speak instead", { exact: true }), p.locator("textarea")]);
  await p.context().close();
}
{
  const p = await inGroup("watch");
  await p.evaluate(() => (window as any).__wingman.router.push("/settings"));
  await p.waitForTimeout(1000);
  await p.getByPlaceholder("e.g. Mom").click();
  await check(p, "kb-08-settings-contact", [p.getByPlaceholder("e.g. Mom")]);
  await p.getByPlaceholder("https://…").click();
  await check(p, "kb-09-settings-server", [p.getByPlaceholder("https://…")]);
  await p.context().close();
}

await browser.close();
server.stop(true);
if (problems.length) {
  console.error("\nKeyboard problems:\n" + [...new Set(problems)].join("\n"));
  process.exit(1);
}
console.log(`\nevery field and primary button stays above a ${KB} pt keyboard · ${out}`);
