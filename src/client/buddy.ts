// Buddy dashboard: live status, map, reasons, the escalation ladder, and a loud alert takeover.

import type { SessionView } from "../shared/types.ts";
import { $, ago, api, connect, esc, fmtM, loopSound, patch, renderLog, successChime, toast, unlockAudio } from "./common.ts";
import { createMap } from "./map.ts";
import { watchLocation } from "./sensors.ts";

const app = $("#app");
const id = location.pathname.split("/")[2] ?? "";
const key = new URLSearchParams(location.search).get("k") ?? "";
const LS = `wingman.buddy.${id}`;

const st = {
  buddyId: "",
  name: "",
  view: null as SessionView | null,
  map: null as ReturnType<typeof createMap> | null,
  stopAlarm: null as null | (() => void),
  dismissed: -1, // stage at which this buddy dismissed the takeover
};

boot();

// Embedded in the stage view: forward presentation-clicker keys to the parent page.
if (window.parent !== window) {
  window.addEventListener("keydown", (e: KeyboardEvent) => parent.postMessage({ wingmanKey: e.key, shift: e.shiftKey }, location.origin));
}

async function boot() {
  if (!id || !key) return renderMessage("This invite link is incomplete.", "Ask your friend to share it again.");
  const saved = JSON.parse(localStorage.getItem(LS) ?? "null");
  const v = await api<SessionView>(`/api/s/${id}`, key).catch(() => null);
  if (!v) return renderMessage("This night out has ended.", "Its data was deleted. Nothing to see here 💜");
  if (saved?.buddyId && v.buddies.some((b) => b.id === saved.buddyId)) {
    st.buddyId = saved.buddyId;
    st.name = saved.name;
    return renderResume(v);
  }
  renderJoin(v);
}

function renderMessage(title: string, sub: string) {
  st.stopAlarm?.();
  app.innerHTML = `<div class="wrap" style="text-align:center;padding-top:70px"><div class="logo" style="width:84px;height:84px;font-size:46px;margin:0 auto;border-radius:24px">🪽</div>
    <h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>`;
}

function renderJoin(v: SessionView) {
  app.innerHTML = `<div class="wrap">
    <div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div><span class="badge">buddy</span></div>
    <div class="hero" style="text-align:left">
      <div class="title">${esc(v.user.name)} asked you to watch their back tonight</div>
      <div class="sub" style="font-size:17px;margin-top:8px">If Wingman thinks they're in trouble (a fall, a missed check-in, slurred speech, drifting off alone),
      this page sounds an alarm and shows you where they are. Keep it open.</div>
    </div>
    <form class="card" id="join" style="margin-top:14px">
      <label for="bname">Your name</label>
      <input id="bname" required maxlength="30" placeholder="Sam" />
      <label class="check"><input type="checkbox" id="shareloc" ${v.demo ? "" : "checked"}/><span>Share my location too, so Wingman notices if ${esc(v.user.name)} drifts away from the group</span></label>
      <button class="btn-primary btn-block btn-xl" type="submit">I've got their back</button>
      <p class="small muted" style="text-align:center;margin:10px 0 0">Tapping enables alarm sounds on this device. ${esc(v.user.name)}'s location is visible ${v.user.shareLocation === "always" ? "only while tonight's session is active" : "only if an alert fires"}.</p>
    </form></div>`;
  $("#join").addEventListener("submit", async (e) => {
    e.preventDefault();
    unlockAudio();
    const name = ($("#bname") as HTMLInputElement).value;
    const share = ($("#shareloc") as HTMLInputElement).checked;
    const r = await api(`/api/s/${id}/join`, key, { name });
    st.buddyId = r.buddyId;
    st.name = r.name;
    localStorage.setItem(LS, JSON.stringify({ buddyId: st.buddyId, name: st.name, share }));
    if (share) shareLocation();
    startDashboard();
  });
}

function renderResume(v: SessionView) {
  app.innerHTML = `<div class="wrap" style="text-align:center;padding-top:60px">
    <div class="logo" style="width:84px;height:84px;font-size:46px;margin:0 auto;border-radius:24px">🪽</div>
    <h1 style="font-size:28px">Watching ${esc(v.user.name)}</h1>
    <p class="muted">Tap to reconnect and re-enable alarm sounds.</p>
    <button class="btn-primary btn-xl btn-block" id="resume">Resume watching</button></div>`;
  $("#resume").addEventListener("click", () => {
    unlockAudio();
    if (JSON.parse(localStorage.getItem(LS) ?? "{}").share) shareLocation();
    startDashboard();
  });
}

function shareLocation() {
  let last = 0;
  watchLocation(
    (fix) => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      api(`/api/s/${id}/signal`, key, { buddyId: st.buddyId, fix }).catch(() => {});
    },
    () => {},
  );
}

function startDashboard() {
  app.innerHTML = `<div class="wrap buddy-wrap">
    <div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div><div class="row" id="badges"></div></div>
    <div class="buddy-cols">
      <div class="stack">
        <div id="status" class="hero"></div>
        <div id="actions" class="grid2"></div>
        <div class="card"><h2 id="ladder-h">Escalation</h2><div class="ladder" id="ladder"></div><div class="small muted" id="next" style="margin-top:8px;text-align:center"></div></div>
        <div class="card" id="check"></div>
        <div class="card" id="sms"></div>
      </div>
      <div class="stack">
        <div class="card"><div class="row spread"><h2 style="margin:0">Live location</h2><span class="muted small" id="dist" style="text-align:right"></span></div><div id="map" class="map" style="margin-top:10px"></div><div id="maplink" class="small" style="margin-top:8px"></div></div>
        <div class="card"><h2>Tonight's log</h2><ul class="log" id="log"></ul></div>
        <div class="card"><h2>Watching with you</h2><div id="buddies" class="stack"></div></div>
      </div>
    </div>
    <p class="small muted" style="text-align:center;margin-top:16px">🔒 Location is visible only during this session or an alert, and is deleted when the night ends.</p>
  </div>
  <div id="takeover" class="overlay alert-ov hidden"></div>`;
  st.map = createMap($("#map"));
  connect({ id, key, buddyId: st.buddyId, onView, onEnded: () => renderMessage("The night out has ended.", "All of tonight's data was deleted. Thanks for looking out 💜") });
  setInterval(() => st.view && renderTicking(st.view), 1000);
}

function onView(v: SessionView) {
  const prev = st.view;
  st.view = v;
  const name = esc(v.user.name);
  $("#badges").innerHTML = `${v.demo ? `<span class="badge demo">DEMO</span>` : ""}<span class="badge"><span class="dot on"></span>${esc(st.name)}</span>`;

  // Status hero
  const level = v.stage > 0 ? "alert" : v.risk.level;
  const s = $("#status");
  s.className = `hero ${level === "ok" ? "" : level}`;
  const title = v.stage > 0 ? `${name} may need help` : level === "watch" ? `Keeping an eye on ${name}` : `${name} is OK`;
  const icon = v.stage > 0 ? "🚨" : level === "watch" ? "👀" : "✓";
  s.innerHTML = `<div class="ring">${icon}</div><div class="title" style="font-size:${v.stage > 0 ? 32 : 28}px">${title}</div>
    ${v.risk.reasons.length ? `<ul class="reasons">${v.risk.reasons.map((r) => `<li>${reasonIcon(r.code)} ${esc(cap(r.text))}<span class="w">+${r.weight}</span></li>`).join("")}</ul>` : `<div class="sub">No warning signs · ${v.signals.backgrounded ? "phone locked / in pocket" : `last heard from ${ago(v.signals.lastHeartbeatAt)}`}</div>`}
    <div class="meter"><div style="width:${v.risk.score}%"></div></div><div class="small muted" style="margin-top:6px">risk ${v.risk.score}/100</div>`;

  // Actions
  const iAcked = v.acks.some((a) => a.name === st.name);
  const tel = v.user.phone ? `tel:${v.user.phone}` : "";
  const actions =
    v.stage > 0
      ? `<button class="btn-ok btn-xl" id="ack" ${iAcked ? "disabled" : ""}>${iAcked ? "✓ You're on the way" : "🏃 I'm on my way"}</button>
         ${tel ? `<a class="btn btn-primary btn-xl" href="${esc(tel)}">📞 Call ${name}</a>` : `<a class="btn btn-alert btn-xl" href="tel:911">📞 Call 911</a>`}
         <button class="btn-ghost" id="safe">✓ I'm with them, they're OK</button>
         <button class="btn-warn" id="escalate" ${v.stage >= 3 ? "disabled" : ""}>⏫ Escalate now</button>`
      : `${tel ? `<a class="btn btn-ghost" href="${esc(tel)}">📞 Call ${name}</a>` : `<span></span>`}<button class="btn-ghost" id="escalate">🚩 I'm worried: alert now</button>`;
  patch($("#actions"), actions, () => {
    $("#ack")?.addEventListener("click", () => buddyAction("ack"));
    $("#safe")?.addEventListener("click", () => buddyAction("safe"));
    $("#escalate")?.addEventListener("click", () => {
      if (st.view?.stage === 0 && !confirm(`Raise an alert for ${st.view.user.name} now?`)) return;
      buddyAction("escalate");
    });
  });

  renderLadder(v);
  // Map + distance
  st.map?.update(v);
  $("#dist").textContent = v.fix ? `${fmtM(v.distanceFromGroupM)} from the group · ±${Math.round(v.fix.accuracy)} m` : v.user.shareLocation === "alert" && v.stage === 0 ? "hidden until an alert (their choice)" : "waiting for GPS…";
  $("#maplink").innerHTML = v.fix ? `<a target="_blank" href="https://maps.google.com/?q=${v.fix.lat},${v.fix.lng}">Open in Maps for directions →</a>` : "";

  // Latest check-in
  const c = [...v.checkins].reverse().find((x) => x.status !== "pending" || x.id === v.checkin?.id);
  $("#check").innerHTML = `<h2>AI check-in</h2>${
    !c
      ? `<div class="muted">No check-ins yet.</div>`
      : c.status === "pending"
        ? `<div style="font-weight:800;color:#c4b5fd">🎙 Asking ${name}: “${esc(c.prompt)}”</div>`
        : c.status === "scoring"
          ? `<div style="font-weight:800;color:#c4b5fd">🧠 Analyzing ${name}'s reply…</div>`
          : `<div style="font-weight:900;font-size:19px;color:${c.outcome === "ok" ? "var(--ok)" : "var(--alert)"}">${c.outcome === "ok" ? "✓ Sounded clear" : c.outcome === "impaired" ? `⚠ Sounded impaired (${Math.round((c.result?.impairment ?? 0) * 100)}%)` : "✕ No answer"}</div>
             ${c.result?.transcript ? `<div style="margin-top:6px">“${esc(c.result.transcript)}”</div>` : ""}
             ${c.result ? `<div class="small muted" style="margin-top:6px">${esc(c.result.reason)}${c.result.signs.length ? ` · ${c.result.signs.map(esc).join(", ")}` : ""} · ${esc(c.result.engine)}</div>` : ""}`
  }`;

  // Level-3 notifications
  const n = v.notifications.at(-1);
  $("#sms").classList.toggle("hidden", !n);
  if (n) {
    $("#sms").innerHTML = `<h2>Emergency contact notified</h2><div class="sms"><div class="meta">${n.channel.toUpperCase()} → ${esc(n.toName)} ${esc(n.to)} · ${n.simulated ? "SIMULATED" : n.ok ? "SENT via Twilio" : "FAILED"}</div>${esc(n.body)}</div>`;
  }

  renderLog($("#log"), v.events);
  $("#buddies").innerHTML = v.buddies
    .map((b) => {
      const ack = v.acks.find((a) => a.name === b.name);
      return `<div class="row"><span class="dot ${b.online ? "on" : ""}"></span><b>${esc(b.name)}${b.id === st.buddyId ? " (you)" : ""}</b>${ack ? `<span class="badge" style="color:#86efac">on the way · ${ago(ack.at)}</span>` : ""}</div>`;
    })
    .join("");

  renderTakeover(v, prev);
  renderTicking(v);
}

function renderLadder(v: SessionView) {
  const rungs = [
    ["Level 1", "Buddies"],
    ["Level 2", "Bystander mode"],
    ["Level 3", "Emergency contact"],
  ];
  $("#ladder").innerHTML = rungs
    .map(([l, t], i) => {
      const n = i + 1;
      const cls = v.stage === n ? "now" : v.stage > n ? "done" : "";
      return `<div class="rung ${cls}">${l}<b>${t}</b></div>`;
    })
    .join("");
}

function renderTicking(v: SessionView) {
  const next = $("#next");
  if (!next) return;
  if (v.stage > 0 && v.nextEscalationAt) {
    const s = Math.max(0, Math.ceil((v.nextEscalationAt - Date.now()) / 1000));
    const what = v.stage === 1 ? "Bystander mode (siren on their phone)" : "Emergency contact gets an SMS";
    next.innerHTML = `<b style="color:#fca5a5">${what} in ${s}s</b>${v.acks.length ? " · paused while a buddy is on the way" : " unless someone responds"}`;
  } else if (v.stage === 3) next.innerHTML = `<b style="color:#fca5a5">All levels triggered.</b> Get to ${esc(v.user.name)} or call 911.`;
  else next.textContent = "Nothing escalated. Alerts climb automatically if nobody responds.";
  const t = $("#tcount");
  if (t && v.nextEscalationAt) t.textContent = `${Math.max(0, Math.ceil((v.nextEscalationAt - Date.now()) / 1000))}s`;
}

function renderTakeover(v: SessionView, prev: SessionView | null) {
  const el = $("#takeover");
  const iAcked = v.acks.some((a) => a.name === st.name);
  const show = v.stage > 0 && !iAcked && st.dismissed < v.stage;
  if (v.stage > 0 && !iAcked && !st.stopAlarm) {
    try {
      st.stopAlarm = loopSound("alarm");
    } catch {}
  }
  if ((v.stage === 0 || iAcked) && st.stopAlarm) {
    st.stopAlarm();
    st.stopAlarm = null;
  }
  if (prev && prev.stage > 0 && v.stage === 0) {
    st.dismissed = -1;
    successChime();
    toast(`Resolved: ${v.user.name} is OK`, 3500);
  }
  if (!show) {
    el.classList.add("hidden");
    return;
  }
  const name = esc(v.user.name);
  const tel = v.user.phone ? `tel:${v.user.phone}` : "tel:911";
  patch(
    el,
    `
    <div class="row spread"><span class="badge" style="background:#00000066;color:white;border-color:#ffffff33">🚨 LEVEL ${v.stage}</span><button class="btn-ghost" id="tclose" style="min-height:40px;padding:8px 14px">Dashboard</button></div>
    <div class="big">${name.toUpperCase()} MAY NEED HELP</div>
    <div id="treasons"></div>
    ${v.stage < 3 && v.nextEscalationAt ? `<div style="text-align:center;margin-top:8px;color:#fecaca">${v.stage === 1 ? "Siren + bystander mode on their phone" : "Emergency contact alerted"} in <b id="tcount"></b></div>` : ""}
    <button class="btn-ok btn-xl btn-block" id="tack" style="margin-top:18px">🏃 I'm on my way</button>
    <div class="grid2" style="margin-top:10px">
      <a class="btn btn-primary btn-xl" href="${esc(tel)}">📞 Call ${v.user.phone ? name : "911"}</a>
      <a class="btn btn-alert btn-xl" href="tel:911">🚑 911</a>
    </div>`,
    () => {
      $("#tack").addEventListener("click", () => buddyAction("ack"));
      $("#tclose").addEventListener("click", () => {
        st.dismissed = st.view?.stage ?? 0;
        st.stopAlarm?.();
        st.stopAlarm = null;
        el.classList.add("hidden");
        setTimeout(() => st.map?.invalidate(), 50);
      });
    },
  );
  patch(
    $("#treasons"),
    `<ul class="reasons">${v.risk.reasons.map((r) => `<li>${reasonIcon(r.code)} ${esc(cap(r.text))}</li>`).join("") || `<li>🚩 Alert raised manually</li>`}</ul>
    ${v.fix ? `<div style="text-align:center;margin-top:12px;font-weight:700"><a style="color:white" target="_blank" href="https://maps.google.com/?q=${v.fix.lat},${v.fix.lng}">📍 Get directions to ${esc(v.user.name)} →</a></div>` : ""}`,
  );
  el.classList.remove("hidden");
  renderTicking(v);
}

async function buddyAction(action: "ack" | "escalate" | "safe") {
  unlockAudio();
  try {
    await api(`/api/s/${id}/buddy/${action}`, key, { buddyId: st.buddyId });
    if (action === "ack") toast("They'll see you're on the way");
  } catch (e) {
    toast((e as Error).message);
  }
}

function reasonIcon(code: string) {
  return ({ fall: "💥", stillness: "🛑", missed_checkin: "🔕", impaired_checkin: "🥴", away_from_group: "📍", geofence: "🚧", offline: "📵", untouched: "📱", late_night: "🌙" } as Record<string, string>)[code] ?? "⚠️";
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
