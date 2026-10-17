import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Playwright's cached Chromium, or CHROMIUM_PATH. */
export function findChromium(): string {
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
