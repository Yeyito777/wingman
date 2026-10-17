// Records the demo video's raw take: one 1080p composition (stage view + two phones running the real app's web build)
// driven through the storyline, captured from a nested X display with ffmpeg x11grab.
//   secrets run --allow GEMINI_API_KEY -- bun scripts/demo-video/record.ts WEBAPP_DIR OUT_DIR
// Env: DISPLAY_REC (nested X display, required), PORT (default 3300). Writes OUT_DIR/take.mkv and OUT_DIR/marks.json.
// Build the web app first: cd mobile && bunx expo export --platform web --output-dir WEBAPP_DIR

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, type Frame, type Page } from "playwright-core";
import { startServer } from "../../src/server/app.ts";

const [WEBAPP, OUT] = process.argv.slice(2);
const DISPLAY = process.env.DISPLAY_REC;
if (!WEBAPP || !OUT || !DISPLAY) throw new Error("usage: DISPLAY_REC=:N record.ts WEBAPP_DIR OUT_DIR");
const PORT = Number(process.env.PORT || 3300);
const W = Number(process.env.REC_W || 1918), H = Number(process.env.REC_H || 1058);
const A = `http://localhost:${PORT}`; // stage + Yeyito's phone
const B = `http://127.0.0.1:${PORT}`; // Sam's phone: a different origin, so its own storage
const VENUE = { latitude: 43.78446, longitude: -79.18747, accuracy: 15 };

const app = startServer({ port: PORT, quiet: true });
const demo = await (await fetch(`${A}/api/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ friends: ["Maya", "Leo"], presenterName: "Yeyito" }) })).json() as any;
const stageUrl = `${A}/stage/${demo.code}?k=${demo.stageKey}`;

const composer = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0b0e17;font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#eef1f8}
#stage{position:absolute;left:28px;top:40px;width:1600px;height:1000px;transform:scale(.66);transform-origin:0 0;border:0;border-radius:18px}
.phone{position:absolute;top:118px;width:390px;height:844px;border:0;border-radius:44px;transform:scale(.97);transform-origin:0 0;box-shadow:0 0 0 10px #1c2232,0 20px 60px rgba(0,0,0,.6)}
#pa{left:1120px} #pb{left:1520px}
.plabel{position:absolute;top:58px;width:378px;text-align:center;font-size:24px;font-weight:600;color:#aab3c8}
.plabel b{color:#fff}
#cap{position:absolute;left:28px;top:745px;width:1040px;font-size:40px;line-height:1.25;font-weight:650;letter-spacing:-.5px}
#cap small{display:block;font-size:26px;font-weight:450;color:#9aa6c0;margin-top:14px;letter-spacing:0}
#card{position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,#1a2340,#0b0e17 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;transition:opacity .6s;z-index:5}
#card.hide{opacity:0;pointer-events:none}
#card h1{font-size:84px;margin:0 0 20px;letter-spacing:-2px}
#card p{font-size:40px;margin:0;color:#c6cee0;max-width:1400px;line-height:1.3}
#card .k{margin-top:46px;font-size:26px;color:#7f8aa6}
</style></head><body>
<iframe id="stage" src="${stageUrl}"></iframe>
<div class="plabel" style="left:1120px"><b>Yeyito's phone</b> · in trouble</div>
<div class="plabel" style="left:1520px"><b>Sam's phone</b> · a friend</div>
<iframe class="phone" id="pa" src="${A}/" allow="geolocation; microphone; autoplay"></iframe>
<iframe class="phone" id="pb" src="${B}/" allow="geolocation; microphone; autoplay"></iframe>
<div id="cap"></div>
<div id="card"></div>
</body></html>`;

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function findChrome() {
  const root = join(homedir(), ".cache/ms-playwright");
  for (const d of ["chromium-1208"]) if (existsSync(join(root, d, "chrome-linux64/chrome"))) return join(root, d, "chrome-linux64/chrome");
  throw new Error("no chromium");
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: false,
  env: { ...process.env, DISPLAY },
  args: ["--kiosk", "--window-position=0,0", `--window-size=${W},${H}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--disable-infobars", "--no-first-run", "--mute-audio"],
});
const ctx = await browser.newContext({ viewport: null, geolocation: VENUE, permissions: ["geolocation", "microphone"] });
const page: Page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
// Serve the composer and the app's static web build on the server's own origins; the API and WebSocket pass through.
for (const origin of [A, B]) {
  await page.route(`${origin}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/__video") return route.fulfill({ contentType: "text/html", body: composer });
    if (/^\/(api|stage|demo-audio|_bun|ws)(\/|$)/.test(u.pathname)) return route.continue();
    const f = join(WEBAPP, decodeURIComponent(u.pathname));
    if (u.pathname !== "/" && existsSync(f) && statSync(f).isFile()) return route.fulfill({ body: readFileSync(f), contentType: MIME[extname(f)] ?? "application/octet-stream" });
    if (extname(u.pathname)) return route.continue();
    return route.fulfill({ contentType: "text/html", body: readFileSync(join(WEBAPP, "index.html")) });
  });
}

// Real fullscreen (no tab strip / URL bar), so the capture is exactly the composition.
const cdp = await ctx.newCDPSession(page);
const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as any;
await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
await Bun.sleep(800);
await page.goto(`${A}/__video`);
const frame = async (sel: string): Promise<Frame> => (await (await page.$(sel))!.contentFrame())!;
const pa = await frame("#pa"), pb = await frame("#pb"), stage = await frame("#stage");
for (const f of [pa, pb]) await f.waitForFunction(() => !!(window as any).__wingman, null, { timeout: 30_000 });

const profile = (name: string, medical: string) => ({ name, phone: "+1 416 555 0123", medical, contactName: "Mom", contactPhone: "+1 416 555 0199" });
async function prep(f: Frame, server: string, p: ReturnType<typeof profile>) {
  await f.waitForFunction(() => (window as any).__wingman.getState().hydrated, null, { timeout: 30_000 });
  await f.evaluate(async ({ server, p }) => {
    const w = (window as any).__wingman;
    await w.savePin("1234");
    w.dispatch({ type: "serverUrl", url: server });
    w.dispatch({ type: "profile", profile: p });
    w.dispatch({ type: "onboarded" });
  }, { server, p });
}
await prep(pa, A, profile("Yeyito", "Allergic to penicillin. Asthma, inhaler in left jacket pocket."));
await prep(pb, B, profile("Sam", ""));
await Bun.sleep(1200); // let AsyncStorage persist, then reload straight into the join screen
await pa.goto(`${A}/join?code=${demo.code}`);
await pb.goto(`${B}/join?code=${demo.code}`);
for (const [f, server] of [[pa, A], [pb, B]] as const) {
  await f.waitForFunction(() => (window as any).__wingman?.getState().hydrated, null, { timeout: 30_000 });
  const st = await f.evaluate(() => { const s = (window as any).__wingman.getState(); return { url: s.serverUrl, onb: s.onboarded, name: s.profile?.name }; });
  console.log("phone state", st);
  if (st.url !== server) throw new Error(`serverUrl not applied: ${st.url}`);
  await f.getByTestId("join-submit").waitFor({ timeout: 20_000 });
}
await Bun.sleep(2500);

// Keys go straight to the stage window (the phones may have keyboard focus).
const stageKey = (k: string) => stage.evaluate((key) => window.dispatchEvent(new KeyboardEvent("keydown", { key })), k);
await stageKey("Shift"); // any key arms the stage (hides its "click to start" banner)
await Bun.sleep(500);

// --- recording ---
const t0 = Date.now();
const marks: Record<string, number> = {};
const mark = (k: string) => { marks[k] = (Date.now() - t0) / 1000; console.log(`[${marks[k]!.toFixed(1)}] ${k}`); };
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "30", "-video_size", `${W}x${H}`, "-i", `${DISPLAY}.0+0,0`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", `${OUT}/take.mkv`], { stdio: ["pipe", "inherit", "inherit"] });
const card = (html: string | null) => page.evaluate((h) => { const c = document.getElementById("card")!; if (h === null) c.classList.add("hide"); else { c.innerHTML = h; c.classList.remove("hide"); } }, html);
const cap = (title: string, sub = "") => page.evaluate(([t, s]) => (document.getElementById("cap")!.innerHTML = `${t}${s ? `<small>${s}</small>` : ""}`), [title, sub]);
const until = async (f: Frame, fn: () => boolean, ms = 60_000) => f.waitForFunction(fn, null, { timeout: ms, polling: 250 });
const bodyHas = (f: Frame, text: string, ms = 60_000) => f.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: ms, polling: 250 });

try {
  await Bun.sleep(800);
  mark("card-open");
  await card(`<div style="font-size:120px">🪽</div><h1>Wingman</h1><p>Every safety app has an SOS button.<br>But if your drink is spiked, you can't press it.</p><div class="k">Hack the Valley 11 · Project KAZE challenge</div>`);
  await Bun.sleep(12_500);
  await cap("A group forms for tonight", "Everyone joins with a 6-letter code. Everyone is everyone's wingman.");
  await card(null);
  mark("group");
  await Bun.sleep(2500);
  await pa.getByTestId("join-submit").click();
  mark("join-a");
  await bodyHas(stage, "Yeyito", 15_000);
  await Bun.sleep(3000);
  await pb.getByTestId("join-submit").click();
  mark("join-b");
  await Bun.sleep(6500);

  await cap("Wingman checks in, out loud", "“Where are you right now, and who are you with?”");
  await stageKey("ArrowRight"); // ① check-in
  mark("checkin");
  const tCheckin = Date.now();
  await bodyHas(pa, "Type instead", 20_000);
  await Bun.sleep(3000);
  await pa.getByText("Type instead").click();
  await Bun.sleep(600);
  await pa.locator("textarea, input").last().pressSequentially("I'm at Hack the Valley with my team.", { delay: 45 });
  await Bun.sleep(500);
  await pa.getByText("Send", { exact: true }).click();
  mark("checkin-sent");
  await bodyHas(stage, "check-in OK", 30_000).catch(() => console.log("no check-in OK seen"));
  mark("checkin-ok");
  await Bun.sleep(Math.max(3000, 11_800 - (Date.now() - tCheckin)));

  await cap("1 AM: drifting away… and a fall", "Location, motion and the phone itself are passive signals.");
  await stageKey("ArrowRight"); // ② drift away
  mark("walk");
  await Bun.sleep(8000);
  await stageKey("ArrowRight"); // ③ fall
  mark("fall");
  await Bun.sleep(3500);

  await cap("Wingman asks again. The answer is slurred.", "Gemini listens to the actual audio, not just the words.");
  mark("ask-again");
  await stageKey("a"); // real audio through Gemini
  await Bun.sleep(5200);
  await stageKey("ArrowRight"); // ④ slurred answer: the stage plays the clip (~11 s), then submits it
  mark("slurred");
  await until(stage, () => !document.getElementById("alarm")!.classList.contains("hidden"), 60_000);
  mark("alert");
  await cap("Every friend's phone alarms", "With the location, the reasons, and “I'm on my way”.");
  await Bun.sleep(4000);
  await bodyHas(pa, "MAY NEED HELP", 40_000).catch(() => console.log("no bystander text seen"));
  mark("bystander");
  await cap("Nobody responds? My phone asks bystanders", "Siren, medical info, Call 911. Then my emergency contact is texted.");
  await Bun.sleep(16_000);
  mark("l3");
  await Bun.sleep(1000);
  await cap("Sam is on the way. Only my PIN cancels it.", "The whole group sees who's coming.");
  await Bun.sleep(3000);
  await pb.getByTestId("on-my-way").click();
  mark("ack");
  await Bun.sleep(3500);
  await pa.getByTestId("im-ok").click();
  mark("pin");
  await Bun.sleep(1200);
  for (const d of "1234") { await pa.getByRole("button", { name: d, exact: true }).click(); await Bun.sleep(450); }
  mark("pin-entered");
  await until(stage, () => document.getElementById("alarm")!.classList.contains("hidden"), 20_000).catch(() => console.log("alarm still up"));
  mark("resolved");
  await cap("Back to green", "No accounts, no database. Everything is deleted when the night ends.");
  await Bun.sleep(1000);
  // The follow-up check-in asked during the alert is moot now: close its sheet, as its own close action does.
  await pa.evaluate(() => { const w = (window as any).__wingman; const s = w.getState(); const id = s.activeCheckin?.id ?? s.view?.members.find((x: any) => x.isYou)?.checkin?.id; if (id) w.dispatch({ type: "handleCheckin", id }); });
  await Bun.sleep(6000);
  await card(`<div style="font-size:110px">🪽</div><h1>Wingman</h1><p>The moment you need help most is the moment you can't ask for it.<br><b style="color:#fff">Your friends' phones ask for you.</b></p><div class="k">Expo iPhone app · Bun + TypeScript server · Gemini audio check-ins · Twilio</div>`);
  mark("card-close");
  await Bun.sleep(10_000);
  mark("end");
} catch (e) {
  console.log("ERROR", e);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  ff.stdin!.write("q");
  await new Promise((r) => ff.on("exit", r));
  await Bun.write(`${OUT}/marks.json`, JSON.stringify(marks, null, 1));
  await browser.close();
  app.stop();
  process.exit(0);
}
