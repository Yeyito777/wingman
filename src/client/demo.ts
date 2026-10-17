// Demo control panel: drive the on-stage storyline deterministically, watch the engine's state live.

import type { SessionView } from "../shared/types.ts";
import { $, ago, api, connect, copyText, esc, fmtM, patch, qrImg, renderLog, toast } from "./common.ts";

const app = $("#app");
const id = location.pathname.split("/")[2] ?? "";
const key = new URLSearchParams(location.search).get("k") ?? "";

const STEPS: [string, string, string, string][] = [
  // [action, label, hint, button class]
  ["walk", "🚶 Walk away from group", "Animates 350 m away from the group over 8 s", "btn-primary"],
  ["fall", "💥 Simulate fall", "Impact + stillness → Wingman asks a check-in", "btn-primary"],
  ["slurred", "🥴 Slurred answer", "Answers the pending check-in (asks one if none)", "btn-alert"],
  ["miss", "🔕 Miss check-in", "Pending check-in times out in 3 s", "btn-warn"],
  ["coherent", "🙂 Coherent answer", "Resolves the alert like a real clear reply", "btn-ok"],
  ["checkin", "🎙 Ask check-in now", "Phone chimes, speaks, records the reply", "btn-ghost"],
  ["ack", "🏃 Buddy: on my way", "First buddy acknowledges (pauses ladder)", "btn-ghost"],
  ["escalate", "⏫ Escalate one level", "Skip the timer", "btn-ghost"],
  ["offline", "📵 Phone goes silent", "Dead-man's switch fires in ~4 s", "btn-ghost"],
  ["online", "📶 Phone back online", "", "btn-ghost"],
  ["back", "↩ Walk back to group", "", "btn-ghost"],
  ["resolve", "✓ Clear alert", "Same as a PIN \"I'm OK\"", "btn-ghost"],
];


function start() {
  const origin = location.origin;
  const phoneUrl = `${origin}/me/${id}?k=${key}`;
  app.innerHTML = `<div class="wrap wide">
    <div class="top"><div class="brand"><div class="logo">🪽</div>Wingman <span class="muted" style="font-weight:600">demo control</span></div>
      <div class="row"><span class="badge demo">DEMO</span><span class="badge" id="engines"></span></div></div>
    <div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;align-items:start" id="cols">
      <div class="stack">
        <div class="card"><h2>Storyline</h2>
          <div class="grid2" id="steps">${STEPS.map(([a, l, h, c]) => `<button class="${c}" data-a="${a}" title="${esc(h)}" style="flex-direction:column;gap:2px">${l}${h ? `<span class="small" style="font-weight:600;opacity:.75">${esc(h)}</span>` : ""}</button>`).join("")}</div>
          <button class="btn-ghost btn-block" data-a="reset" style="margin-top:12px;border-color:#7f1d1d;color:#fca5a5">⟲ Reset session (keeps people connected)</button>
        </div>
        <div class="card"><h2>Scripted answers</h2>
          <div class="seg">
            <label><input type="radio" name="mode" value="canned" checked/><span>Canned text · deterministic</span></label>
            <label><input type="radio" name="mode" value="live"/><span>Real audio → AI (cached)</span></label>
          </div>
          <p class="small muted" style="margin:8px 0 0">"Real audio" sends a pre-recorded voice clip through the live scorer. Use canned on stage so a rate limit can't bite.</p>
        </div>
        <div class="card"><h2>Timers (seconds)</h2>
          <div class="grid2" id="timers"></div>
          <div class="row" style="margin-top:10px"><button class="btn-ghost grow" id="tdemo">Demo preset</button><button class="btn-ghost grow" id="treal">Real-world preset</button></div>
        </div>
        <div class="card"><h2>Open on devices</h2>
          <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
            <div style="text-align:center">${qrImg(phoneUrl)}<div class="small" style="margin-top:6px;font-weight:800">📱 Person's phone</div><button class="btn-ghost small" id="cphone" style="min-height:36px;margin-top:6px">copy</button> <a class="small" target="_blank" href="${esc(phoneUrl)}">open</a></div>
            <div style="text-align:center" id="buddyqr"></div>
          </div>
          <a class="btn btn-primary btn-block" id="stagelink" target="_blank" style="margin-top:12px">🎬 Open stage view (projector + clicker)</a>
          <p class="small muted">Phones need HTTPS for motion, location and mic (run <code>bun run tunnel</code>, then open this panel via the tunnel URL).</p>
        </div>
      </div>
      <div class="stack">
        <div class="card" id="state"></div>
        <div class="card" id="checkcard"></div>
        <div class="card" id="smscard"></div>
        <div class="card"><h2>Event log</h2><ul class="log" id="log" style="max-height:420px"></ul></div>
      </div>
    </div></div>`;
  if (innerWidth < 760) $("#cols").style.gridTemplateColumns = "1fr";
  app.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-a]");
    if (!b) return;
    const a = b.dataset.a!;
    if (a === "reset" && !confirm("Reset the session (clears alerts, check-ins and the log)?")) return;
    b.disabled = true;
    try {
      await api(`/api/s/${id}/demo/${a}`, key, {});
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setTimeout(() => (b.disabled = false), 400);
    }
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => api(`/api/s/${id}/settings`, key, { demoAnswerMode: r.value }).then(() => toast(`Scripted answers: ${r.value}`))),
  );
  $("#cphone").addEventListener("click", () => copyText(phoneUrl));
  $("#stagelink").setAttribute("href", `/stage/${id}?k=${key}`);
  $("#tdemo").addEventListener("click", () => api(`/api/s/${id}/settings`, key, { timers: "demo" }).then(() => toast("Demo timers")));
  $("#treal").addEventListener("click", () => api(`/api/s/${id}/settings`, key, { timers: "real" }).then(() => toast("Real-world timers")));
  connect({ id, key, as: "demo", onView, onEnded: () => (app.innerHTML = `<div class="wrap"><h1>Session ended</h1><p class="muted">All data deleted.</p><a class="btn btn-primary" href="/">New session</a></div>`) });
  setInterval(() => st && renderState(st), 1000);
}

let st: SessionView | null = null;

const TIMER_FIELDS: [keyof SessionView["timers"], string][] = [
  ["l1ToL2Ms", "L1 → L2 (bystander)"],
  ["l2ToL3Ms", "L2 → L3 (contact)"],
  ["checkinTimeoutMs", "Check-in answer window"],
  ["ackHoldMs", "Buddy ack pauses for"],
  ["checkinEveryMs", "Check-in every (0 = off)"],
  ["fallConfirmMs", "Fall stillness confirm"],
];

function onView(v: SessionView) {
  st = v;
  $("#engines").textContent = `AI: ${v.engines.scorer} · L3: ${v.engines.notifier}`;
  patch($("#buddyqr"), `${qrImg(v.inviteUrl ?? "")}<div class="small" style="margin-top:6px;font-weight:800">👥 Buddy link</div><button class="btn-ghost small" id="cbuddy" style="min-height:36px;margin-top:6px">copy</button> <a class="small" target="_blank" href="${esc(v.inviteUrl ?? "")}">open</a>`, () =>
    $("#cbuddy").addEventListener("click", () => copyText(v.inviteUrl ?? "")),
  );
  patch(
    $("#timers"),
    TIMER_FIELDS.map(([k, l]) => `<div><label for="t-${k}">${l}</label><input id="t-${k}" data-k="${k}" type="number" min="0" step="1" value="${Math.round(v.timers[k] / 1000)}"/></div>`).join(""),
    () =>
      document.querySelectorAll<HTMLInputElement>("#timers input").forEach((inp) =>
        inp.addEventListener("change", () => api(`/api/s/${id}/settings`, key, { timers: { [inp.dataset.k!]: Number(inp.value) * 1000 } }).then(() => toast("Timer updated"))),
      ),
  );
  renderState(v);
  const c = [...v.checkins].reverse()[0];
  $("#checkcard").innerHTML = `<h2>Check-in</h2>${
    !c
      ? `<div class="muted">None yet.</div>`
      : `<div><b>${esc(c.status === "done" ? c.outcome ?? "cancelled" : c.status)}</b> · ${esc(c.trigger)} · asked ${ago(c.askedAt)}</div>
         <div class="small muted" style="margin-top:4px">“${esc(c.prompt)}”</div>
         ${c.result ? `<div style="margin-top:8px">“${esc(c.result.transcript)}”</div><div class="small" style="margin-top:4px;color:#c4b5fd">impairment ${Math.round(c.result.impairment * 100)}% · ${esc(c.result.reason)} · ${esc(c.result.engine)}${c.result.model ? ` (${esc(c.result.model)})` : ""} · ${c.result.latencyMs} ms${c.result.fallbackFrom ? ` · fell back from ${esc(c.result.fallbackFrom)}` : ""}</div>` : ""}`
  }`;
  const n = v.notifications.at(-1);
  $("#smscard").innerHTML = `<h2>Level 3 · emergency contact</h2>${n ? `<div class="sms"><div class="meta">${n.channel.toUpperCase()} → ${esc(n.toName)} ${esc(n.to)} · ${n.simulated ? "SIMULATED" : n.ok ? "SENT (Twilio)" : "FAILED"}</div>${esc(n.body)}</div>` : `<div class="muted">Nothing sent. ${esc(v.user.contactName)} ${esc(v.user.contactPhone)} gets an ${v.engines.notifier === "twilio" ? "SMS via Twilio" : "SMS (simulated)"} at level 3.</div>`}`;
  renderLog($("#log"), v.events);
  const mode = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${v.demoAnswerMode ?? "canned"}"]`);
  if (mode) mode.checked = true;
}

function renderState(v: SessionView) {
  const next = v.nextEscalationAt ? Math.max(0, Math.ceil((v.nextEscalationAt - Date.now()) / 1000)) : null;
  const stageName = ["Monitoring", "L1 · Buddies alerted", "L2 · Bystander mode", "L3 · Emergency contact"][v.stage];
  const color = v.stage > 0 ? "var(--alert)" : v.risk.level === "watch" ? "var(--watch)" : "var(--ok)";
  $("#state").innerHTML = `<h2>Engine state</h2>
    <div style="font-size:30px;font-weight:900;color:${color}">${stageName}</div>
    <div class="muted">${next !== null ? `next level in ${next}s${v.acks.length ? " (paused by buddy ack)" : ""}` : v.stage === 3 ? "top of the ladder" : "no escalation pending"}</div>
    <div class="meter"><div style="width:${v.risk.score}%"></div></div>
    <div class="row spread small" style="margin-top:6px"><span>risk <b>${v.risk.score}</b>/100 · ${v.risk.level}</span><span>${fmtM(v.distanceFromGroupM)} from group</span></div>
    <ul class="reasons">${v.risk.reasons.map((r) => `<li>${esc(r.text)}<span class="w">+${r.weight}</span></li>`).join("") || `<li class="muted">No active signals</li>`}</ul>
    <div class="row wrap-row small muted" style="margin-top:10px;gap:14px">
      <span>📱 heartbeat ${ago(v.signals.lastHeartbeatAt)}</span><span>🏃 moved ${ago(v.signals.lastMotionAt)}</span>
      <span>sensors: motion ${esc(v.signals.sensors.motion)}, location ${esc(v.signals.sensors.location)}, mic ${esc(v.signals.sensors.mic)}</span>
      <span>👥 ${v.buddies.map((b) => `${esc(b.name)}${b.online ? " ●" : " ○"}`).join(", ") || "no buddies"}</span>
    </div>`;
}

// ---------------- stage view: buddy dashboard for the projector + clicker-driven storyline ----------------

const STORY: { label: string; hint: string; actions: string[] }[] = [
  { label: "🎙 Live check-in", hint: "Phone asks out loud. Answer clearly → Gemini: ✓", actions: ["checkin"] },
  { label: "🚶 Walk away from the group", hint: "Map: 350 m from the group. Phone asks where you're headed", actions: ["scene", "walk"] },
  { label: "💥 Fall detected", hint: "Impact + stillness", actions: ["fall"] },
  { label: "🥴 Slurred answer", hint: "AI flags slurred speech → LEVEL 1. Then L2 siren, L3 SMS on timers", actions: ["slurred"] },
  { label: "🏃 Sam: \"I'm on my way\"", hint: "Visible on the phone and to every buddy", actions: ["ack"] },
  { label: "🔢 PIN on the phone", hint: "Enter 1234 on the bystander screen → resolved", actions: [] },
];

function stage() {
  let step = 0;
  document.body.style.overflow = "hidden";
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr) 340px;height:100dvh">
    <iframe id="buddyframe" style="border:0;width:100%;height:100%;background:var(--bg)" allow="autoplay; geolocation"></iframe>
    <aside style="border-left:1px solid var(--line);padding:16px;overflow:auto;background:#0a0e18">
      <div class="brand" style="font-size:18px"><div class="logo">🪽</div>Wingman <span class="badge demo">STAGE</span></div>
      <ol id="story" style="list-style:none;padding:0;margin:16px 0 0"></ol>
      <div class="card" style="margin-top:14px;padding:12px" id="mini"></div>
      <p class="small muted" style="margin-top:12px">Clicker / <b>→</b> <b>Space</b> <b>PgDn</b>: next step · <b>Shift+R</b>: reset session.
        First click into the dashboard once and press <i>I've got their back</i> to arm the alarm sound.</p>
      <div id="phoneqr" class="small muted"></div>
    </aside></div>`;
  const render = () => {
    $("#story").innerHTML = STORY.map(
      (s, i) => `<li style="padding:10px 12px;border-radius:12px;margin-bottom:8px;border:1px solid ${i === step ? "var(--accent)" : "var(--line)"};background:${i < step ? "#0f1a12" : i === step ? "#1d1640" : "transparent"};opacity:${i < step ? 0.6 : 1}">
        <div style="font-weight:800">${i < step ? "✓ " : `${i + 1}. `}${esc(s.label)}</div><div class="small muted">${esc(s.hint)}</div></li>`,
    ).join("") + (step >= STORY.length ? `<li class="small muted" style="padding:8px">Storyline done. Shift+R to reset.</li>` : "");
  };
  render();
  const next = async () => {
    if (step >= STORY.length) return;
    const s = STORY[step++]!;
    render();
    for (const a of s.actions) await api(`/api/s/${id}/demo/${a}`, key, {}).catch((e) => toast(e.message));
  };
  const reset = async () => {
    if (!confirm("Reset the session for another run?")) return;
    step = 0;
    render();
    await api(`/api/s/${id}/demo/reset`, key, {});
  };
  const onKey = (k: string, shift: boolean) => {
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(k)) next();
    else if ((k === "R" || k === "r") && shift) reset();
  };
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) e.preventDefault();
    onKey(e.key, e.shiftKey);
  });
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.origin === location.origin && e.data?.wingmanKey) onKey(e.data.wingmanKey, !!e.data.shift);
  });
  let framed = false;
  connect({
    id,
    key,
    as: "demo",
    onView: (v) => {
      if (!framed && v.inviteUrl) {
        framed = true;
        ($("#buddyframe") as HTMLIFrameElement).src = v.inviteUrl.replace(/^https?:\/\/[^/]+/, location.origin);
        $("#phoneqr").innerHTML = `<div style="margin-top:10px">${qrImg(`${location.origin}/me/${id}?k=${key}`)}<div style="margin-top:4px">📱 Person's phone</div></div>`;
      }
      const stageName = ["Monitoring", "L1 · Buddies", "L2 · Bystander", "L3 · Contact"][v.stage];
      const nxt = v.nextEscalationAt ? ` · next in ${Math.max(0, Math.ceil((v.nextEscalationAt - Date.now()) / 1000))}s` : "";
      $("#mini").innerHTML = `<div style="font-weight:900;color:${v.stage ? "var(--alert)" : v.risk.level === "watch" ? "var(--watch)" : "var(--ok)"}">${stageName}${nxt}</div>
        <div class="meter"><div style="width:${v.risk.score}%"></div></div><div class="small muted" style="margin-top:4px">risk ${v.risk.score} · AI ${esc(v.engines.scorer)}</div>`;
    },
    onEnded: () => (app.innerHTML = `<div class="wrap"><h1>Session ended</h1></div>`),
  });
}

// Entry point last, so every module-level constant above is initialized.
if (!id || !key) app.innerHTML = `<div class="wrap"><h1>Missing session or key</h1></div>`;
else if (location.pathname.startsWith("/stage/")) stage();
else start();
