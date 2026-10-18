// Minimal web fallback (the real client is the iPhone app): landing page, create/join a group, a plain member view
// with alerts (on my way / found & OK), PIN "I'm OK", typed check-in answers, location + heartbeat.

import type { GroupView, JoinResponse, MemberView, ServerMsg } from "../shared/types.ts";
import { $, api, chime, connect, esc, fmtM, loopSound, patch, qrImg, speak, toast, unlockAudio } from "./common.ts";

const app = $("#app");
const path = location.pathname.split("/");
const code = path[1] === "g" ? (path[2] ?? "").toUpperCase() : "";
const store = (c: string) => `wingman:${c}`;

function landing() {
  app.innerHTML = `<div class="wrap stack landing">
    <div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div></div>
    <div class="hero"><h1>Your friends,<br/>watching your back.</h1>
      <p class="muted">Wingman notices when someone in your group can't ask for help (a fall, a slurred answer, wandering off) and gets the others there.</p></div>
    <div class="card"><label for="jc" style="margin-top:0">Join tonight's group</label><input id="jc" placeholder="6-letter code" maxlength="6" autocapitalize="characters" autocomplete="off"/>
      <button class="btn-primary btn-block" id="join" style="margin-top:10px">Join</button>
      <button class="btn-ghost btn-block" id="new" style="margin-top:10px">Start a new group</button>
      <p class="muted small" style="margin:12px 0 0">Best in the Wingman iPhone app. This browser version covers the basics.</p></div>
    <p class="small center"><button class="linkish" id="demo">Presenting? Create a stage demo</button></p>
  </div>`;
  $("#join").onclick = () => {
    const c = ($("#jc") as HTMLInputElement).value.trim().toUpperCase();
    if (c.length === 6) location.href = `/g/${c}`;
  };
  $("#new").onclick = () => setupForm(null);
  $("#demo").onclick = async () => {
    const d = await api("/api/demo", "", {});
    location.href = `/stage/${d.code}?k=${d.stageKey}`;
  };
}

function setupForm(joinCode: string | null) {
  app.innerHTML = `<div class="wrap stack"><div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div>${joinCode ? `<span class="badge">${esc(joinCode)}</span>` : ""}</div>
    <form class="card" id="f"><h2>${joinCode ? "Join tonight's group" : "Start a group"}</h2>
      <label>Your name</label><input name="name" required maxlength="30"/>
      <label>PIN (cancels your own alert)</label><input name="pin" required inputmode="numeric" pattern="\\d{4,8}" placeholder="4-8 digits"/>
      <label>Your phone (friends can call you)</label><input name="phone" inputmode="tel"/>
      <label>Medical info (shown only during an alert)</label><input name="medical"/>
      <label>Emergency contact name</label><input name="cname"/><label>Emergency contact phone</label><input name="cphone" inputmode="tel"/>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="consent" required style="width:auto"/> I'll be guarded tonight and guard everyone else</label>
      <button class="btn-primary btn-block" style="margin-top:12px">${joinCode ? "Join" : "Create group"}</button></form></div>`;
  ($("#f") as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    unlockAudio();
    const f = new FormData(e.target as HTMLFormElement);
    const member = {
      name: String(f.get("name")),
      pin: String(f.get("pin")),
      phone: String(f.get("phone") ?? ""),
      medical: String(f.get("medical") ?? ""),
      emergencyContact: { name: String(f.get("cname") ?? ""), phone: String(f.get("cphone") ?? "") },
      consent: f.get("consent") === "on",
      tzOffset: new Date().getTimezoneOffset(),
    };
    try {
      const r: JoinResponse = joinCode ? await api(`/api/groups/${joinCode}/join`, "", member) : await api("/api/groups", "", { member });
      localStorage.setItem(store(r.code), JSON.stringify({ memberId: r.memberId, key: r.key }));
      location.href = `/g/${r.code}`;
    } catch (err) {
      toast((err as Error).message);
    }
  };
}

function member(c: string, me: { memberId: string; key: string }) {
  let view: GroupView | null = null;
  let stop: (() => void) | null = null;
  let spoken = "";
  const base = `/api/groups/${c}/members`;
  app.innerHTML = `<div class="wrap stack"><div class="top"><div class="brand"><div class="logo">🪽</div>Wingman</div><span class="badge">${esc(c)}</span></div>
    <div id="alerts"></div><div id="checkin"></div><div class="card" id="members"></div>
    <div class="card"><h2>Invite</h2><div id="invite"></div></div>
    <div class="row"><button class="btn-ghost grow" id="leave">Leave group</button><button class="btn-ghost grow" id="end">End night for everyone</button></div></div>`;

  const act = async (p: string, body: unknown = {}) => {
    try {
      return await api(p, me.key, body);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const row = (m: MemberView) =>
    `<div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--line)"><div><b style="color:${m.color}">${esc(m.name)}</b>${m.isYou ? " (you)" : ""}<div class="small muted">${esc(m.risk.reasons.length ? m.risk.summary : "all good")}${m.distanceFromGroupM !== null ? ` · ${fmtM(m.distanceFromGroupM)} from the group` : ""}</div></div><span class="small">${m.alert ? `🚨 L${m.alert.stage}` : m.presence}</span></div>`;

  const render = (v: GroupView) => {
    view = v;
    const you = v.members.find((m) => m.isYou)!;
    patch($("#members"), `<h2>${esc(v.name)}</h2>${v.members.map(row).join("")}`);
    patch($("#invite"), `${qrImg(v.links.joinUrl)}<p class="small">Code <b>${esc(v.code)}</b> · ${esc(v.links.joinUrl)}</p>`);
    const html = v.alerts
      .map((a) => {
        const m = v.members.find((x) => x.id === a.memberId)!;
        if (m.isYou)
          return `<div class="card" style="border-color:var(--alert);background:#2a0d10"><h2 style="color:#fecaca">${a.bystander ? "THIS PERSON MAY NEED HELP" : "Your friends were alerted"}</h2>
            ${a.bystander ? `<p><b>Medical:</b> ${esc(m.medical || "—")}</p><a class="btn btn-alert btn-block" href="tel:911">Call 911</a>` : ""}
            <label>I'm OK: enter your PIN</label><div class="row"><input id="pin" inputmode="numeric" class="grow"/><button class="btn-ok" id="pinok">I'm OK</button></div></div>`;
        return `<div class="card" style="border-color:var(--alert);background:#2a0d10"><h2 style="color:#fecaca">${esc(m.name)} may need help · L${a.stage}</h2>
          <p>${esc(m.risk.summary)}</p>${a.acks.length ? `<p class="small">${a.acks.map((k) => `${esc(k.byName)} is on the way`).join(" · ")}</p>` : ""}
          <div class="row"><button class="btn-primary grow" data-ack="${m.id}">I'm on my way</button><button class="btn-ok grow" data-found="${m.id}">Found &amp; OK</button></div>
          ${m.phone ? `<a class="btn btn-ghost btn-block" style="margin-top:8px" href="tel:${esc(m.phone)}">Call ${esc(m.name)}</a>` : ""}</div>`;
      })
      .join("");
    patch($("#alerts"), html, () => {
      app.querySelectorAll<HTMLButtonElement>("[data-ack]").forEach((b) => (b.onclick = () => act(`${base}/${b.dataset.ack}/ack`)));
      app.querySelectorAll<HTMLButtonElement>("[data-found]").forEach((b) => (b.onclick = () => act(`${base}/${b.dataset.found}/resolve`)));
      const ok = $("#pinok");
      if (ok) ok.onclick = () => act(`${base}/${me.memberId}/resolve`, { pin: ($("#pin") as HTMLInputElement).value });
    });
    const others = v.alerts.filter((a) => a.memberId !== me.memberId).length;
    if (others && !stop) stop = loopSound(you.alert?.bystander ? "siren" : "alarm");
    if (!v.alerts.length && stop) (stop(), (stop = null));
    const c = you.checkin;
    patch(
      $("#checkin"),
      c && c.status === "pending" ? `<div class="card"><h2>Check-in</h2><p>${esc(c.prompt)}</p><div class="row"><input id="ans" class="grow" placeholder="Type your answer"/><button class="btn-primary" id="send">Send</button></div></div>` : "",
      () => {
        const s = $("#send");
        if (s && c) s.onclick = () => act(`${base}/${me.memberId}/checkins/${c.id}/answer`, { text: ($("#ans") as HTMLInputElement).value });
        // Typing an answer holds the check-in's deadline (the server gives 50 s past the last keystroke).
        const ans = $("#ans") as HTMLInputElement | null;
        let sentAt = 0;
        if (ans && c)
          ans.oninput = () => {
            if (!ans.value.trim() || Date.now() - sentAt < 4000) return;
            sentAt = Date.now();
            ws.send({ t: "signals", answering: c.id, interaction: true });
          };
      },
    );
    if (c && c.status === "pending" && spoken !== c.id) {
      spoken = c.id;
      chime();
      void speak(c.prompt);
    }
  };

  const ws = connect({
    code: c,
    key: me.key,
    memberId: me.memberId,
    onView: render,
    onMsg: (m: ServerMsg) => m.t === "ack" && toast(`${m.ack.byName} is on the way to ${m.alert.memberName}`),
    onEnded: (reason) => {
      localStorage.removeItem(store(c));
      stop?.();
      app.innerHTML = `<div class="wrap"><h1>Night ended</h1><p class="muted">${esc(reason)}. All data was deleted.</p><a href="/">Home</a></div>`;
    },
  });
  // Signals: heartbeat + app state + location.
  let fix: { lat: number; lng: number; accuracy: number } | undefined;
  navigator.geolocation?.watchPosition((p) => (fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => {}, { enableHighAccuracy: true });
  const beat = () => ws.send({ t: "signals", heartbeat: true, appState: document.hidden ? "background" : "foreground", fix, sensors: { location: fix ? "on" : "unknown" } });
  setInterval(beat, 5000);
  document.addEventListener("visibilitychange", beat);
  document.addEventListener("pointerdown", () => ws.send({ t: "signals", interaction: true }));
  $("#leave").onclick = () => confirm("Leave the group? Your data is deleted.") && act(`${base}/${me.memberId}/leave`);
  $("#end").onclick = () => confirm("End the night for everyone? All data is deleted.") && act(`/api/groups/${c}/end`);
  void view;
}

if (!code) landing();
else {
  const saved = localStorage.getItem(store(code));
  if (saved) member(code, JSON.parse(saved));
  else setupForm(code);
}
