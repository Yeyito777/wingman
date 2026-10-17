/// <reference types="bun" />
// UI end-to-end against a REAL group server: the web build is served same-origin with /api and /ws proxied to the
// server (it has no CORS). Drives join → friend alert → "I'm on my way" → own bystander mode → PIN → check-in → end.
// Usage: WINGMAN_URL=http://localhost:3100 bun tools/e2e-real.ts   (after `npx expo export --platform web --output-dir dist`)
import { chromium, type Page } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const API = (process.env.WINGMAN_URL ?? "http://localhost:3100").replace(/\/$/, "");
const root = new URL("../", import.meta.url).pathname;
const dist = root + "dist/";
const out = root + "docs/screenshots/real/";
mkdirSync(out, { recursive: true });

type WsData = { upstream?: WebSocket; url: string; queue: string[] };
const server = Bun.serve<WsData>({
  port: 0,
  async fetch(req, srv) {
    const u = new URL(req.url);
    if (u.pathname === "/ws") {
      if (srv.upgrade(req, { data: { url: API.replace(/^http/, "ws") + u.pathname + u.search, queue: [] } })) return;
      return new Response("upgrade failed", { status: 400 });
    }
    if (u.pathname.startsWith("/api/")) {
      const headers = new Headers(req.headers);
      headers.delete("host");
      return fetch(API + u.pathname + u.search, { method: req.method, headers, body: req.method === "GET" ? undefined : await req.arrayBuffer() });
    }
    const f = Bun.file(dist + u.pathname.replace(/^\/+/, ""));
    if (u.pathname !== "/" && (await f.exists())) return new Response(f);
    return new Response(Bun.file(dist + "index.html"), { headers: { "content-type": "text/html" } });
  },
  websocket: {
    open(ws) {
      const up = new WebSocket(ws.data.url);
      ws.data.upstream = up;
      up.onmessage = (e) => ws.send(String(e.data));
      up.onclose = () => ws.close();
      up.onopen = () => ws.data.queue.splice(0).forEach((m) => up.send(m));
    },
    message(ws, m) {
      const up = ws.data.upstream;
      if (up?.readyState === 1) up.send(String(m));
      else ws.data.queue.push(String(m));
    },
    close(ws) {
      ws.data.upstream?.close();
    },
  },
});
const base = `http://localhost:${server.port}`;
const dir = `${homedir()}/.cache/ms-playwright`;
const exe = readdirSync(dir).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse().map((d) => `${dir}/${d}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync)!;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? exe });
const errors: string[] = [];
const step = (s: string) => console.log("→", s);

const api = async (path: string, body?: unknown, key?: string) => {
  const r = await fetch(API + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page: Page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
const shot = async (n: string, wait = 700) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out + n + ".png" });
  console.log("📸", n);
};

try {
  step("create a demo group with simulated friends");
  const demo = await api("/api/demo", {});
  const code: string = demo.code;

  step("set up the app and join " + code);
  await page.goto(base + "/");
  await page.waitForFunction(() => (window as any).__wingman);
  await page.getByText("Get started").waitFor();
  await page.evaluate(async (b) => {
    const w = (window as any).__wingman;
    w.dispatch({ type: "serverUrl", url: b });
    w.dispatch({ type: "profile", profile: { name: "Yeyito", phone: "+14165550123", medical: "Allergic to penicillin. Asthma, inhaler in left jacket pocket.", contactName: "Mom", contactPhone: "+14165550199" } });
    w.dispatch({ type: "onboarded" });
    await w.savePin("1234");
    w.router.replace("/join?code=" + "CODE".replace("CODE", (window as any).__code ?? ""));
  }, base);
  await page.evaluate((c) => (window as any).__wingman.router.replace({ pathname: "/join", params: { code: c } }), code);
  await page.getByText(/out tonight/).waitFor({ timeout: 10_000 });
  await shot("01-join-preview");
  await page.getByTestId("join-submit").click();
  await page.getByText("You", { exact: true }).waitFor({ timeout: 10_000 });
  await shot("02-group", 2500);

  const st = await page.evaluate(() => (window as any).__wingman.getState());
  const me = st.membership;
  const maya = st.view.members.find((m: any) => m.name === "Maya");
  if (!maya) throw new Error("no Maya in demo group");

  step("Maya's alert reaches this phone");
  await api(`/api/groups/${code}/members/${maya.id}/escalate`, {}, me.key);
  await page.getByText(/may need help/i).first().waitFor({ timeout: 10_000 });
  await shot("03-alert-takeover");
  await page.getByTestId("on-my-way").click();
  await page.waitForTimeout(1500);
  // (simulated Maya may answer her alert check-in and resolve it right away, so look in the event log)
  const v1 = await api(`/api/groups/${code}/view`, undefined, me.key);
  const acked = v1.alerts.find((a: any) => a.memberId === maya.id)?.acks.some((k: any) => k.by === me.memberId) || v1.events.some((e: any) => /Yeyito/.test(e.text) && /way/i.test(e.text));
  if (!acked) errors.push("ack not recorded on the server: " + JSON.stringify(v1.events.slice(-6).map((e: any) => e.text)));
  await shot("04-group-on-my-way");
  await api(`/api/groups/${code}/members/${maya.id}/resolve`, {}, me.key);

  step("own alert climbs to bystander mode");
  await api(`/api/groups/${code}/members/${me.memberId}/escalate`, {}, me.key);
  await api(`/api/groups/${code}/members/${me.memberId}/escalate`, {}, me.key);
  await page.getByText("THIS PERSON MAY NEED HELP").waitFor({ timeout: 10_000 });
  await shot("05-bystander");
  await page.getByTestId("im-ok").click();
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByText(/Wrong PIN/).waitFor({ timeout: 5000 });
  await shot("06-wrong-pin", 300);
  for (const d of "1234") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByText("THIS PERSON MAY NEED HELP").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.getByText("Enter your PIN").waitFor({ state: "detached", timeout: 10_000 });
  await shot("07-after-pin");

  step("server-asked check-in, typed answer, scored");
  await api(`/api/groups/${code}/members/${me.memberId}/checkins`, {}, me.key);
  await page.getByText("Wingman check-in").waitFor({ timeout: 10_000 });
  await shot("08-checkin", 1200);
  await page.getByText("Type instead").click();
  await page.locator("textarea").fill("I'm at the Rex on Queen Street with Sam and Maya, heading home in an hour.");
  await page.getByText("Send", { exact: true }).click();
  await page.getByText(/You sound good|Thanks/).waitFor({ timeout: 30_000 });
  await shot("09-checkin-result", 300);

  step("end the night");
  await api(`/api/groups/${code}/end`, {}, me.key);
  await page.getByText(/Going out/).waitFor({ timeout: 10_000 });
  await shot("10-ended");
} catch (e) {
  errors.push(String(e));
  await page.screenshot({ path: out + "failure.png" });
}

await browser.close();
server.stop(true);
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("real-server UI flow OK");
