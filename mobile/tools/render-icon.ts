/// <reference types="bun" />
// Renders assets/brand/icon.svg to the PNG icon, splash and favicon. Run: bun tools/render-icon.ts
import { chromium } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const root = new URL("../", import.meta.url).pathname;
const svg = await Bun.file(root + "assets/brand/icon.svg").text();
const dir = `${homedir()}/.cache/ms-playwright`;
const exe = readdirSync(dir).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse().map((d) => `${dir}/${d}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync)!;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? exe });

async function render(out: string, size: number, html: string) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: root + out, omitBackground: true });
  await page.close();
}

const scaled = (size: number, s: string) => s.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
await render("assets/images/icon.png", 1024, scaled(1024, svg));
await render("assets/images/favicon.png", 48, scaled(48, svg));
// Splash: the wings only, on transparent (the splash background is black).
const wings = svg.replace(/<rect[^>]*\/>/, "");
await render("assets/images/splash-icon.png", 512, scaled(512, wings));
await render("assets/images/android-icon-foreground.png", 512, scaled(512, wings));
await browser.close();
console.log("icons written");
