// The person's phone: setup + consent, passive sensing, AI voice check-ins, and bystander mode.

import type { Checkin, SessionView } from "../shared/types.ts";
import { $, ago, api, chime, connect, copyText, esc, loopSound, qrImg, speak, successChime, toast, unlockAudio } from "./common.ts";
import { batteryLevel, keepAwake, recordReply, requestMic, requestMotionPermission, startFallDetector, watchLocation, type Recording } from "./sensors.ts";

const LS_SESSION = "wingman.session";
const LS_PROFILE = "wingman.profile";
const app = $("#app");

const st = {
  id: "",
  key: "",
  view: null as SessionView | null,
  armed: false,
  sensors: { motion: "off", location: "off", mic: "off" },
  pending: { hb: false, motion: false, interaction: false, fix: null as null | { lat: number; lng: number; accuracy: number } },
  handled: new Set<string>(),
  current: null as null | { id: string; rec: Recording | null; phase: string },
  stopSiren: null as null | (() => void),
  verdictTimer: 0 as any,
};

// ---------------- boot ----------------

boot();

function boot() {
  const m = location.pathname.match(/^\/me\/([a-z0-9]+)/);
  const saved = readSaved();
  if (m) {
    const q = new URLSearchParams(location.search);
    const k = q.get("k") ?? (saved?.id === m[1] ? saved.key : "");
    if (!k) return renderSetup("That session link is missing its key. Start a new night below.");
    st.id = m[1]!;
    st.key = k;
    localStorage.setItem(LS_SESSION, JSON.stringify({ id: st.id, key: st.key }));
    if (q.has("k")) history.replaceState(null, "", `/me/${st.id}`);
    return startDashboard();
  }
  renderSetup();
}

function readSaved(): { id: string; key: string } | null {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSION) ?? "null");
  } catch {
    return null;
  }
}

// ---------------- setup + consent ----------------

function renderSetup(notice = "") {
  const p = (() => {
    try {
      return JSON.parse(localStorage.getItem(LS_PROFILE) ?? "{}");
    } catch {
      return {};
    }
  })();
  const saved = readSaved();
  const demoDefault = new URLSearchParams(location.search).has("demo");
  app.innerHTML = `
  <div class="wrap">
    <div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div><span class="badge">night-out guardian</span></div>
    <div class="hero" style="text-align:left">
      <div class="title" style="font-size:30px">Going out tonight?</div>
      <div class="sub" style="font-size:17px;margin-top:8px">Wingman quietly watches your back: it notices a fall, a missed check-in, slurred speech or drifting from your group,
      and gets your friends to you, <b style="color:var(--text)">without you ever pressing SOS.</b></div>
    </div>
    ${notice ? `<div class="card" style="margin-top:12px;border-color:#78350f">${esc(notice)}</div>` : ""}
    ${saved ? `<a class="btn btn-ghost btn-block" style="margin-top:12px" href="/me/${esc(saved.id)}">↩ Return to tonight's session</a>` : ""}
    <form id="setup" class="card" style="margin-top:14px" autocomplete="on">
      <h2>About you</h2>
      <label for="name">Your first name</label>
      <input id="name" name="name" required maxlength="40" placeholder="Yeyito" value="${esc(p.name ?? "")}" />
      <label for="phone">Your phone number <span class="muted">(so buddies can call you)</span></label>
      <input id="phone" name="phone" type="tel" placeholder="+1 416 555 0123" value="${esc(p.phone ?? "")}" />
      <label for="pin">A 4-digit PIN <span class="muted">(only you can cancel an alarm)</span></label>
      <input id="pin" name="pin" inputmode="numeric" pattern="\\d{4,8}" required maxlength="8" placeholder="••••" type="password" />
      <label for="medical">Medical info for first responders</label>
      <textarea id="medical" name="medical" placeholder="Allergies, medications, conditions, blood type…">${esc(p.medical ?? "")}</textarea>
      <h2 style="margin-top:22px">Emergency contact <span class="muted" style="text-transform:none;letter-spacing:0">(last resort)</span></h2>
      <div class="grid2">
        <div><label for="contactName">Name</label><input id="contactName" name="contactName" placeholder="Mom" value="${esc(p.contactName ?? "")}" /></div>
        <div><label for="contactPhone">Phone</label><input id="contactPhone" name="contactPhone" type="tel" placeholder="+1 416 555 0199" value="${esc(p.contactPhone ?? "")}" /></div>
      </div>
      <h2 style="margin-top:22px">Location sharing</h2>
      <div class="seg">
        <label><input type="radio" name="shareLocation" value="always" ${p.shareLocation !== "alert" ? "checked" : ""}/><span>While tonight's session runs</span></label>
        <label><input type="radio" name="shareLocation" value="alert" ${p.shareLocation === "alert" ? "checked" : ""}/><span>Only if an alert fires</span></label>
      </div>
      <label class="check"><input type="checkbox" name="demo" ${demoDefault ? "checked" : ""}/><span><b>Demo mode</b>: fast timers + a control panel for presenting</span></label>
      <label class="check"><input type="checkbox" name="consent" required/><span>I'm opting in <b>for tonight only</b>. Wingman uses motion, location and my check-in replies while this session runs,
        and <b>deletes everything when I end the night</b>.</span></label>
      <button class="btn btn-primary btn-block btn-xl" type="submit">🪽 Start my night out</button>
      <p class="small muted" style="text-align:center;margin:10px 0 0">You'll be asked for motion, location and microphone access.</p>
    </form>
    <p class="small muted" style="text-align:center;margin-top:18px">Presenting on a laptop? <a href="#" id="stage">Create a stage demo</a> and scan the QR with your phone.</p>
  </div>`;
  $("#setup").addEventListener("submit", onStart);
  $("#stage").addEventListener("click", async (e) => {
    e.preventDefault();
    const r = await api("/api/sessions", "", stagePersona());
    location.href = `/demo/${r.id}?k=${r.userKey}`;
  });
}

function stagePersona() {
  return {
    name: "Yeyito",
    phone: "+1 416 555 0123",
    pin: "1234",
    medical: "Allergic to penicillin. Asthma: inhaler in left jacket pocket. Blood type O+.",
    contactName: "Mom",
    contactPhone: "+1 416 555 0199",
    shareLocation: "always",
    demo: true,
    tzOffset: new Date().getTimezoneOffset(),
  };
}

async function onStart(e: Event) {
  e.preventDefault();
  const f = new FormData(e.target as HTMLFormElement);
  // Permission prompts must start inside the tap (iOS), before any network await.
  const armed = arm();
  const body = {
    name: String(f.get("name")),
    phone: String(f.get("phone") ?? ""),
    pin: String(f.get("pin")),
    medical: String(f.get("medical") ?? ""),
    contactName: String(f.get("contactName") ?? ""),
    contactPhone: String(f.get("contactPhone") ?? ""),
    shareLocation: String(f.get("shareLocation")),
    demo: f.get("demo") === "on",
    tzOffset: new Date().getTimezoneOffset(),
  };
  const { pin: _pin, demo: _demo, tzOffset: _tz, ...profile } = body;
  localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
  try {
    const r = await api("/api/sessions", "", body);
    st.id = r.id;
    st.key = r.userKey;
    localStorage.setItem(LS_SESSION, JSON.stringify({ id: st.id, key: st.key }));
    history.replaceState(null, "", `/me/${st.id}`);
    startDashboard(armed);
  } catch (err) {
    toast(String((err as Error).message));
  }
}

// ---------------- arming sensors ----------------

let fall: ReturnType<typeof startFallDetector> | null = null;

async function arm() {
  unlockAudio();
  const motionP = requestMotionPermission();
  const micP = requestMic();
  watchLocation(
    (fix) => {
      st.pending.fix = fix;
      sendSignals(false);
    },
    (s) => setSensor("location", s),
  );
  const motion = await motionP;
  setSensor("motion", motion);
  if (motion === "on" && !fall) {
    fall = startFallDetector({
      confirmMs: () => st.view?.timers.fallConfirmMs ?? 10_000,
      onMove: () => (st.pending.motion = true),
      onFall: (peakG) => {
        api(`/api/s/${st.id}/signal`, st.key, { fall: { peakG } }).catch(() => {});
        toast(`Possible fall detected (${peakG.toFixed(1)} g)`);
      },
    });
    // No samples after a few seconds (desktop / blocked) -> report it honestly.
    setTimeout(() => fall && fall.samples === 0 && setSensor("motion", "no sensor"), 3000);
  }
  setSensor("mic", await micP);
  await keepAwake();
  st.armed = true;
  $("#arm")?.remove();
  startHeartbeat();
  if (st.view?.status === "active") speak(`Wingman is on. Have a great night, ${st.view.user.name}.`);
}

function setSensor(k: keyof typeof st.sensors, v: string) {
  st.sensors[k] = v;
  if (st.id) api(`/api/s/${st.id}/signal`, st.key, { sensors: st.sensors }).catch(() => {});
  if (st.view) renderSensors(st.view);
}

let hbStarted = false;
function startHeartbeat() {
  if (hbStarted) return;
  hbStarted = true;
  for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, () => (st.pending.interaction = true), { passive: true });
  setInterval(() => sendSignals(true), 5000);
  sendSignals(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      navigator.sendBeacon?.(`/api/s/${st.id}/signal?k=${encodeURIComponent(st.key)}`, new Blob([JSON.stringify({ hidden: true })], { type: "text/plain" }));
    } else sendSignals(true);
  });
}

let lastFixSent = 0;
async function sendSignals(hb: boolean) {
  if (!st.id) return;
  const body: any = {};
  if (hb) {
    body.hb = true;
    body.battery = await batteryLevel();
    body.sensors = st.sensors;
  }
  if (st.pending.motion) body.motion = true;
  if (st.pending.interaction) body.interaction = true;
  if (st.pending.fix && (hb || Date.now() - lastFixSent > 3000)) {
    body.fix = st.pending.fix;
    lastFixSent = Date.now();
    st.pending.fix = null;
  }
  if (Object.keys(body).length === 0) return;
  st.pending.motion = false;
  st.pending.interaction = false;
  api(`/api/s/${st.id}/signal`, st.key, body).catch(() => {});
}

// ---------------- dashboard ----------------

function startDashboard(armed?: Promise<void>) {
  app.innerHTML = `
  <div class="wrap">
    <div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div><div class="row" id="badges"></div></div>
    <div id="hero" class="hero"></div>
    <div class="card" style="margin-top:12px" id="invite"></div>
    <div class="card" style="margin-top:12px"><h2>Watching</h2><div id="sensors" class="sensors"></div></div>
    <div class="card" style="margin-top:12px" id="lastcheck"></div>
    <div class="grid2" style="margin-top:12px">
      <button class="btn-primary" id="checknow">🎙 Check in now</button>
      <button class="btn-ghost" id="end">End night</button>
    </div>
    <div id="democard"></div>
    <p class="small muted" style="text-align:center;margin-top:16px">🔒 Opted in for tonight only. Buddies see your location only during this session (or only on alert, if you chose that).
    Ending the night deletes everything on the server.</p>
  </div>
  <div id="checkin-ov" class="overlay checkin-ov hidden"></div>
  <div id="bystander" class="overlay bystander hidden"></div>`;
  if (!armed) {
    const ov = document.createElement("div");
    ov.id = "arm";
    ov.className = "overlay checkin-ov";
    ov.innerHTML = `<div class="logo" style="width:84px;height:84px;font-size:46px;margin:0 auto;border-radius:24px">🪽</div>
      <div class="q">Tap to start guarding</div>
      <div class="state" style="color:#c4b5fd">Turns on fall detection, location and voice check-ins for tonight.</div>
      <button class="btn-primary btn-xl btn-block" style="margin-top:26px" id="armbtn">I'm ready</button>`;
    app.append(ov);
    $("#armbtn").addEventListener("click", () => arm());
  }
  $("#checknow").addEventListener("click", () => api(`/api/s/${st.id}/checkin`, st.key, {}).catch((e) => toast(e.message)));
  $("#end").addEventListener("click", endNight);
  connect({ id: st.id, key: st.key, onView, onEnded: renderEnded });
  setInterval(() => st.view && renderTicking(st.view), 1000);
}

function onView(v: SessionView) {
  const prev = st.view;
  st.view = v;
  renderBadges(v);
  renderHero(v);
  if (!prev || prev.buddies.length !== v.buddies.length || prev.buddies.some((b, i) => b.online !== v.buddies[i]?.online) || !$("#invite").innerHTML) renderInvite(v);
  renderSensors(v);
  renderLastCheck(v);
  renderDemoCard(v);
  handleCheckin(v);
  renderBystander(v, prev);
}

function renderBadges(v: SessionView) {
  $("#badges").innerHTML = `${v.demo ? `<span class="badge demo">DEMO</span>` : ""}<span class="badge" id="elapsed"></span>`;
  renderTicking(v);
}

function renderTicking(v: SessionView) {
  const el = $("#elapsed");
  if (el) {
    const m = Math.floor((Date.now() - v.startedAt) / 60000);
    el.textContent = `🕒 ${m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`}`;
  }
  const cd = $("#cd");
  if (cd && v.checkin) cd.textContent = `${Math.max(0, Math.ceil((v.checkin.deadline - Date.now()) / 1000))} s to answer`;
}

function renderHero(v: SessionView) {
  const h = $("#hero");
  const level = v.stage > 0 ? "alert" : v.risk.level;
  h.className = `hero ${level === "ok" ? "" : level}`;
  const title = v.stage > 0 ? "Your buddies were alerted" : level === "watch" ? "Keeping a closer eye" : "You're covered";
  const icon = v.stage > 0 ? "🚨" : level === "watch" ? "👀" : "🪽";
  const acks = v.acks.length ? `<div class="sub" style="color:#86efac;font-weight:800">✓ ${v.acks.map((a) => esc(a.name)).join(", ")} on the way</div>` : "";
  h.innerHTML = `<div class="ring">${icon}</div><div class="title">${title}</div>
    <div class="sub">${v.risk.level === "ok" && v.stage === 0 ? `${v.buddies.length ? `${v.buddies.length} buddy${v.buddies.length > 1 ? "s" : ""} watching` : "Invite a buddy to watch your back"} · no SOS button needed` : esc(v.risk.summary)}</div>${acks}
    <div class="meter"><div style="width:${v.risk.score}%"></div></div>`;
}

function renderInvite(v: SessionView) {
  const url = v.inviteUrl ?? "";
  const list = v.buddies.length
    ? v.buddies.map((b) => `<div class="row"><span class="dot ${b.online ? "on" : ""}"></span><b>${esc(b.name)}</b><span class="muted small">${b.online ? "watching" : "offline"}</span></div>`).join("")
    : `<div class="muted">No buddies yet. Share the link: anyone with it can watch tonight.</div>`;
  $("#invite").innerHTML = `<h2>Your buddies</h2>
    <div class="row" style="align-items:flex-start;gap:14px">
      ${qrImg(url)}
      <div class="grow stack">${list}
        <button class="btn-primary btn-block" id="share">📨 Invite a buddy</button>
      </div>
    </div>`;
  $("#share").addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Watch my back tonight", text: `${v.user.name} added you as a Wingman buddy for tonight.`, url });
        return;
      } catch {}
    }
    copyText(url);
  });
}

function renderSensors(v: SessionView) {
  const s = st.sensors;
  const batt = v.signals.battery;
  const cell = (label: string, val: string, good: boolean | null) => `<div class="sensor ${good === null ? "" : good ? "good" : "bad"}"><b>${val}</b>${label}</div>`;
  const loc = v.fix ? `±${Math.round(v.fix.accuracy)}m` : s.location === "denied" ? "✕" : "…";
  $("#sensors").innerHTML =
    cell("motion", s.motion === "on" ? "✓" : s.motion === "denied" ? "✕" : "–", s.motion === "on" ? true : s.motion === "denied" ? false : null) +
    cell("location", loc, v.fix ? true : s.location === "denied" ? false : null) +
    cell("mic", s.mic === "on" ? "✓" : s.mic === "denied" ? "✕" : "–", s.mic === "on" ? true : s.mic === "denied" ? false : null) +
    cell("battery", batt !== null ? `${batt}%` : "–", batt === null ? null : batt > 15);
}

function renderLastCheck(v: SessionView) {
  const c = [...v.checkins].reverse().find((x) => x.status === "done" && x.outcome);
  const el = $("#lastcheck");
  if (!c) {
    el.innerHTML = `<h2>AI check-ins</h2><div class="muted">${v.timers.checkinEveryMs ? `Every ${Math.round(v.timers.checkinEveryMs / 60000)} min, and whenever something looks off.` : "Whenever something looks off (demo mode)."} Your phone will chime and ask a quick question out loud. Just answer.</div>`;
    return;
  }
  const color = c.outcome === "ok" ? "var(--ok)" : "var(--alert)";
  const label = c.outcome === "ok" ? "✓ Sounded good" : c.outcome === "impaired" ? "⚠ Sounded impaired" : "✕ Missed";
  el.innerHTML = `<h2>Last check-in · ${ago(c.answeredAt ?? c.deadline)}</h2>
    <div style="font-weight:800;color:${color};font-size:19px">${label}</div>
    ${c.result?.transcript ? `<div style="margin-top:6px">“${esc(c.result.transcript)}”</div>` : ""}
    ${c.result ? `<div class="small muted" style="margin-top:6px">${esc(c.result.reason)} · ${esc(c.result.engine)}${c.result.model ? ` (${esc(c.result.model)})` : ""}</div>` : ""}`;
}

function renderDemoCard(v: SessionView) {
  const el = $("#democard");
  if (!v.demo || el.dataset.done) return;
  el.dataset.done = "1";
  const demoUrl = `${location.origin}/demo/${v.id}?k=${st.key}`;
  el.innerHTML = `<div class="card" style="margin-top:12px;border-color:#78350f"><h2>Demo controls</h2>
    <div class="row"><button class="btn-warn grow" id="copydemo">Copy demo-panel link</button><a class="btn btn-ghost" href="${demoUrl}" target="_blank">Open</a></div></div>`;
  $("#copydemo").addEventListener("click", () => copyText(demoUrl));
}

// ---------------- AI check-ins ----------------

function handleCheckin(v: SessionView) {
  const ov = $("#checkin-ov");
  const c = v.checkin;
  if (c && c.status === "pending" && !st.handled.has(c.id) && v.stage < 2) {
    st.handled.add(c.id);
    runCheckin(c, v);
    return;
  }
  const cur = st.current;
  if (!cur) return;
  const done = v.checkins.find((x) => x.id === cur.id);
  if (c?.id === cur.id && c.status === "scoring") {
    cur.rec?.cancel();
    setPhase(`🧠 Analyzing your reply with ${v.engines.scorer.split(" ")[0]}…`);
    $("#cbars")?.classList.add("hidden");
    $("#cactions")?.classList.add("hidden");
  } else if (done && done.status === "done") {
    cur.rec?.cancel();
    st.current = null;
    if (!done.outcome) {
      ov.classList.add("hidden");
      return;
    }
    showVerdict(done, v);
  }
  if (v.stage >= 2) ov.classList.add("hidden");
}

async function runCheckin(c: Checkin, v: SessionView) {
  clearTimeout(st.verdictTimer);
  st.current = { id: c.id, rec: null, phase: "" };
  const ov = $("#checkin-ov");
  const alertNote = v.stage === 1 ? `<div class="badge" style="background:#450a0a;color:#fecaca;border-color:#7f1d1d">🚨 Your buddies were alerted</div>` : `<div class="badge" style="background:#1d1640;color:#ddd6fe;border-color:#4c1d95">🪽 Wingman check-in</div>`;
  ov.innerHTML = `${alertNote}
    <div class="q">${esc(c.prompt)}</div>
    <div class="bars hidden" id="cbars">${"<i></i>".repeat(9)}</div>
    <div class="state" id="cphase">…</div>
    <div class="countdown" id="cd"></div>
    <div id="cverdict"></div>
    <div id="cactions" style="margin-top:22px">
      <button class="btn-primary btn-block hidden" id="cagain">🎙 Tap to answer</button>
      <button class="btn-ghost btn-block hidden" id="cstop" style="margin-top:10px">✓ Done talking</button>
      <details style="margin-top:14px;text-align:left"><summary class="muted">Can't talk? Type instead</summary>
        <div class="row" style="margin-top:8px"><input id="ctext" placeholder="Where are you, who are you with?" /><button class="btn-primary" id="csend">Send</button></div>
      </details>
    </div>`;
  ov.classList.remove("hidden");
  $("#cstop").addEventListener("click", () => st.current?.rec?.stop());
  $("#cagain").addEventListener("click", () => {
    unlockAudio();
    listen(c);
  });
  $("#csend").addEventListener("click", () => {
    const text = ($("#ctext") as HTMLInputElement).value.trim();
    if (!text) return;
    st.current?.rec?.cancel();
    api(`/api/s/${st.id}/checkin/${c.id}/answer`, st.key, { text }).catch((e) => toast(e.message));
  });
  renderTicking(v);
  navigator.vibrate?.([250, 120, 250]);
  if (!st.armed) {
    setPhase("Tap below to answer out loud");
    $("#cagain").classList.remove("hidden");
    return;
  }
  chime();
  await sleep(700);
  if (st.current?.id !== c.id) return;
  setPhase("🔊 …");
  await speak(c.prompt);
  if (st.current?.id !== c.id) return;
  if (!c.autoListen) {
    setPhase("Tap to answer out loud");
    $("#cagain").classList.remove("hidden");
    return;
  }
  listen(c);
}

async function listen(c: Checkin) {
  if (st.current?.id !== c.id) return;
  $("#cagain").classList.add("hidden");
  $("#cstop").classList.remove("hidden");
  $("#cbars").classList.remove("hidden");
  setPhase("🎙 Listening… answer out loud");
  const bars = [...document.querySelectorAll<HTMLElement>("#cbars i")];
  let rec: Recording;
  try {
    rec = recordReply({
      maxMs: 9000,
      onLevel: (l) => bars.forEach((b, i) => (b.style.height = `${10 + l * 60 * (0.5 + Math.abs(Math.sin(i * 1.7 + Date.now() / 120)) * 0.5)}px`)),
    });
  } catch {
    setPhase("Microphone unavailable: type your answer below");
    return;
  }
  st.current.rec = rec;
  const r = await rec.done.catch(() => null);
  if (st.current?.id !== c.id || st.view?.checkin?.id !== c.id || st.view.checkin.status !== "pending") return;
  $("#cbars").classList.add("hidden");
  $("#cstop").classList.add("hidden");
  if (!r) {
    setPhase("Microphone unavailable: type your answer below");
    return;
  }
  if (!r.spoke) {
    setPhase("I didn't catch that.");
    $("#cagain").classList.remove("hidden");
    return;
  }
  setPhase("⬆️ Sending…");
  api(`/api/s/${st.id}/checkin/${c.id}/answer`, st.key, r.blob, { headers: { "content-type": r.mime } }).catch((e) => {
    setPhase(`Couldn't send (${e.message}). Tap to try again.`);
    $("#cagain").classList.remove("hidden");
  });
}

function setPhase(t: string) {
  const el = $("#cphase");
  if (el) el.textContent = t;
}

function showVerdict(c: Checkin, v: SessionView) {
  const ov = $("#checkin-ov");
  $("#cbars")?.classList.add("hidden");
  $("#cactions")?.classList.add("hidden");
  $("#cd") && ($("#cd").textContent = "");
  const r = c.result;
  let html: string;
  if (c.outcome === "ok") {
    successChime();
    html = `<div class="verdict" style="color:#86efac">✓ You sound good. Have fun!</div>`;
    setPhase(r?.transcript ? `“${r.transcript.slice(0, 120)}”` : "");
  } else if (c.outcome === "impaired") {
    html = `<div class="verdict" style="color:#fca5a5">You don't sound okay.<br/>I'm letting your buddies know.</div>`;
    setPhase(r?.reason ?? "");
  } else {
    html = `<div class="verdict" style="color:#fca5a5">No answer. I'm letting your buddies know.</div>`;
    setPhase("");
  }
  $("#cverdict").innerHTML = html + (r ? `<div class="small" style="margin-top:8px;color:#c4b5fd">${esc(r.engine)}${r.model ? ` · ${esc(r.model)}` : ""} · ${r.latencyMs} ms</div>` : "");
  st.verdictTimer = setTimeout(() => ov.classList.add("hidden"), c.outcome === "ok" ? 3500 : 4500);
  if (v.stage >= 2) ov.classList.add("hidden");
}

// ---------------- bystander mode (level 2+) ----------------

function renderBystander(v: SessionView, prev: SessionView | null) {
  const el = $("#bystander");
  if (v.stage < 2) {
    if (!el.classList.contains("hidden")) {
      el.classList.add("hidden");
      $(".modal")?.remove();
    }
    st.stopSiren?.();
    st.stopSiren = null;
    if (prev && prev.stage > 0 && v.stage === 0) {
      successChime();
      toast("Alert resolved. Glad you're OK 💜", 3000);
    }
    return;
  }
  st.current?.rec?.cancel();
  $("#checkin-ov").classList.add("hidden");
  if (!st.stopSiren) {
    try {
      st.stopSiren = loopSound("siren");
    } catch {}
  }
  const acks = v.acks.map((a) => `<b>${esc(a.name)}</b> is on the way`).join("<br/>");
  const contact = v.user.contactPhone ? `<a href="tel:${esc(v.user.contactPhone)}" style="color:#fde68a;font-weight:800">${esc(v.user.contactName)} · ${esc(v.user.contactPhone)}</a>` : esc(v.user.contactName);
  const html = `
    <div class="warn">This person may need help</div>
    <div class="who">${esc(v.user.name)} isn't responding. Their friends have been alerted.</div>
    <a class="call911" href="tel:911">📞 CALL 911</a>
    <div class="panel"><h3>Medical info</h3><div style="font-size:18px;font-weight:600">${esc(v.user.medical || "None provided")}</div></div>
    <div class="panel"><h3>Emergency contact</h3><div style="font-size:18px">${contact}${v.stage >= 3 ? `<div class="small" style="color:#fca5a5;margin-top:4px">✓ Notified with location</div>` : ""}</div></div>
    ${acks ? `<div class="panel"><h3>Help coming</h3><div style="font-size:17px">${acks}</div></div>` : ""}
    <div class="panel"><h3>Why</h3><div>${esc(v.risk.summary)}</div></div>
    <button class="btn imok btn-block" id="imok">I'm OK: enter PIN to cancel</button>`;
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
    $("#imok").addEventListener("click", openPinPad);
  }
  el.classList.remove("hidden");
}

function openPinPad() {
  if ($(".modal")) return;
  let pin = "";
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="sheet"><div style="font-weight:900;font-size:22px">Enter your PIN</div>
    <div class="muted small">Only ${esc(st.view?.user.name ?? "the owner")} can cancel this alarm.</div>
    <div class="pindots">${"<i></i>".repeat(4)}</div><div id="pinmsg" class="small" style="color:#fca5a5;min-height:20px"></div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "✕", 0, "⌫"].map((k) => `<button data-k="${k}">${k}</button>`).join("")}</div></div>`;
  document.body.append(m);
  const dots = () => m.querySelectorAll(".pindots i").forEach((d, i) => d.classList.toggle("on", i < pin.length));
  m.addEventListener("click", async (e) => {
    const k = (e.target as HTMLElement).dataset?.k;
    if (k === undefined) return;
    if (k === "✕") return m.remove();
    if (k === "⌫") pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    dots();
    if (pin.length === 4) {
      try {
        await api(`/api/s/${st.id}/pin`, st.key, { pin });
        m.remove();
      } catch (err: any) {
        pin = "";
        dots();
        const until = err.data?.lockedUntil;
        $("#pinmsg").textContent = until ? `Locked. Try again in ${Math.ceil((until - Date.now()) / 1000)} s.` : "Wrong PIN";
      }
    }
  });
}

// ---------------- end ----------------

async function endNight() {
  if (!confirm("End tonight's session? Your buddies stop watching and all session data is deleted.")) return;
  await api(`/api/s/${st.id}/end`, st.key, {}).catch(() => {});
  renderEnded();
}

function renderEnded() {
  st.stopSiren?.();
  localStorage.removeItem(LS_SESSION);
  app.innerHTML = `<div class="wrap" style="text-align:center;padding-top:60px">
    <div class="logo" style="width:84px;height:84px;font-size:46px;margin:0 auto;border-radius:24px">🪽</div>
    <h1 style="font-size:30px">Night ended</h1>
    <p class="muted">Your location, check-ins and event log were deleted from the server. Get home safe.</p>
    <a class="btn btn-primary" href="/">Start a new night</a></div>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
