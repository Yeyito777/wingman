/// <reference types="bun" />
// Screenshots every screen of the web build at iPhone 13 size into docs/screenshots/, against the in-app mock server.
// Usage: npx expo export --platform web --output-dir dist && bun tools/screenshots.ts
import { chromium, type Page } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const root = new URL("../", import.meta.url).pathname;
const dist = root + "dist/";
const out = process.env.SHOTS_OUT ? process.env.SHOTS_OUT.replace(/\/?$/, "/") : root + "docs/screenshots/";
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
const errors: string[] = [];

async function fresh(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource|aria-hidden|CORS policy/.test(m.text()) && errors.push(m.text()));
  return page;
}

async function shot(page: Page, name: string, wait = 600) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}${name}.png` });
  // Layout guard: nothing may overflow the viewport horizontally.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push(`${name}: horizontal overflow`);
  console.log("📸", name);
}

const click = (page: Page, text: string) => page.getByText(text, { exact: true }).first().click();

// --- onboarding
{
  const p = await fresh();
  await p.goto(base + "/");
  await shot(p, "01-welcome", 1200);
  await click(p, "Get started");
  await p.getByTestId("name-input").fill("Yeyito");
  await shot(p, "02-name");
  await click(p, "Continue");
  for (const d of "12") await p.getByRole("button", { name: d, exact: true }).click();
  await shot(p, "03-pin");
  const dotsY = async () => (await p.getByTestId("pin-dots").boundingBox())?.y;
  const y1 = await dotsY();
  for (const d of "34") await p.getByRole("button", { name: d, exact: true }).click();
  await p.waitForTimeout(400);
  for (const d of "1") await p.getByRole("button", { name: d, exact: true }).click();
  await shot(p, "03b-pin-again");
  // Layout guard: the dots must not jump between "Choose a PIN" and "Enter it again".
  const y2 = await dotsY();
  if (y1 === undefined || y1 !== y2) errors.push(`PIN dots moved between the two PIN steps: ${y1} → ${y2}`);
  for (const d of "234") await p.getByRole("button", { name: d, exact: true }).click();
  await p.waitForTimeout(500);
  await p.locator("textarea").fill("Allergic to penicillin. Asthma, inhaler in left jacket pocket.");
  await shot(p, "04-medical");
  await click(p, "Continue");
  await p.getByPlaceholder("Name (e.g. Mom)").fill("Mom");
  await p.getByPlaceholder("Phone number").fill("+1 416 555 0199");
  await shot(p, "05-contact");
  await click(p, "Continue");
  await shot(p, "06-permission-location");
  await click(p, "Not now");
  await shot(p, "07-permission-motion");
  for (let i = 0; i < 2; i++) await click(p, "Not now");
  await click(p, "Not now");
  await shot(p, "08-start", 800);
  await click(p, "Join with code");
  await p.getByTestId("code-input").fill("K7Q2XM");
  await shot(p, "09-join");
  // Deep link wingman://join/CODE lands on the join screen with the code filled in.
  await p.goto(base + "/join/MAYA42");
  await p.waitForTimeout(1200);
  if ((await p.getByTestId("code-input").inputValue()) !== "MAYA42") errors.push("deep link /join/CODE did not fill the code");
  await p.context().close();
}

// --- in a group (mock server)
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
  const p = await inGroup();
  await shot(p, "10-group", 900);
  await click(p, "Map");
  await shot(p, "11-group-map");
  await click(p, "People");
  await p.getByRole("button", { name: "Invite friends" }).click();
  await shot(p, "12-invite", 900);
  await p.getByRole("button", { name: "Close" }).click();
  await p.waitForTimeout(400);
  await click(p, "Sam");
  await shot(p, "13-member");
  await p.context().close();
}
{
  const p = await inGroup("checkin");
  await shot(p, "14-checkin", 1500);
  await click(p, "Type instead");
  await p.locator("textarea").fill("At the Rex on Queen with Sam and Maya");
  await shot(p, "15-checkin-typed");
  await click(p, "Send");
  await shot(p, "16-checkin-ok", 1400);
  await p.context().close();
}
{
  const p = await inGroup("friend-alert");
  await shot(p, "17-alert-takeover", 1000);
  await click(p, "I'm on my way");
  await shot(p, "18-group-on-my-way", 900);
  await click(p, "Maya");
  await shot(p, "19-member-alert", 900);
  await p.context().close();
}
{
  const p = await inGroup("bystander");
  await shot(p, "20-bystander", 900);
  await p.getByTestId("im-ok").click();
  for (const d of "99") await p.getByRole("button", { name: d, exact: true }).click();
  await shot(p, "21-bystander-pin");
  await p.context().close();
}
{
  const p = await inGroup("watch");
  await p.evaluate(() => (window as any).__wingman.router.push("/settings"));
  await shot(p, "22-settings", 1000);
  await p.context().close();
}

await browser.close();
server.stop(true);
if (errors.length) {
  console.error("\nErrors:\n" + [...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("\nall screens OK");
