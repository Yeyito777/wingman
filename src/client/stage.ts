// Projector stage view: a calm, big-type group dashboard (member cards + map), an alarm takeover when anyone is in
// alert, and a minimal storyline sidebar driven by a presentation clicker (→ / Space / PgDn).

import { STORY } from "../shared/story.ts";
import type { AlertState, GroupView, MemberView, ServerMsg } from "../shared/types.ts";
import { $, api, clock, connect, engineLabel, esc, fmtM, loopSound, patch, qrImg, successChime, toast, unlockAudio } from "./common.ts";
import { createMap } from "./map.ts";

const app = $("#app");
const code = location.pathname.split("/")[2] ?? "";
const key = new URLSearchParams(location.search).get("k") ?? "";

let view: GroupView | null = null;
let step = 0;
let armed = false;
let stopAlarm: (() => void) | null = null;

function shell() {
  document.body.classList.add("stage");
  app.innerHTML = `<div class="st">
    <header class="st-top">
      <div class="brand"><div class="logo">🪽</div>Wingman <span class="st-name" id="gname"></span></div>
      <div class="st-join" id="join"></div>
    </header>
    <main class="st-main">
      <section class="st-cards" id="cards"></section>
      <section class="st-map"><div id="map"></div></section>
      <div class="st-alarm hidden" id="alarm"></div>
    </main>
    <aside class="st-side">
      <h3>Storyline</h3>
      <ol class="st-story" id="story"></ol>
      <div class="st-subject" id="subject"></div>
      <div class="st-foot" id="foot"></div>
      <p class="st-keys">→ / Space: next · S: switch who's in trouble · A: answer mode · Shift+R: reset</p>
    </aside>
    <div class="st-arm" id="arm">Click or press → to start (arms the alarm sound)</div>
  </div>`;
}

/** Whose story the storyline tells: the clicked/selected member, else the real phone, else the first friend
 *  (the same default the server uses). */
let subjectId: string | null = null;
const currentSubject = (v: GroupView): MemberView | undefined =>
  v.members.find((m) => m.id === subjectId) ?? v.members.find((m) => !m.simulated) ?? v.members[0];

function statusPill(m: MemberView) {
  if (m.alert) return `<span class="pill alert">ALERT · L${m.alert.stage}</span>`;
  if (m.presence === "silent") return `<span class="pill alert">SILENT</span>`;
  if (m.risk.level === "watch") return `<span class="pill watch">WATCH</span>`;
  return `<span class="pill ok">OK</span>`;
}

function card(m: MemberView) {
  const line = m.risk.reasons.length
    ? esc(cap(m.risk.summary))
    : m.distanceFromGroupM !== null
      ? `With the group${m.distanceFromGroupM > 0 ? ` · ${fmtM(m.distanceFromGroupM)}` : ""}`
      : m.presence === "offline"
        ? "Not connected yet"
        : "With the group";
  const ci = m.checkin
    ? `<span class="ci pending">🎙 ${m.checkin.status === "scoring" ? "scoring answer…" : "being checked in"}</span>`
    : m.lastCheckin?.outcome
      ? `<span class="ci ${m.lastCheckin.outcome}">${m.lastCheckin.outcome === "ok" ? "✓ check-in OK" : m.lastCheckin.outcome === "impaired" ? "⚠ check-in sounded impaired" : "✕ missed check-in"}</span>`
      : "";
  const bat = m.signals.battery !== null ? `🔋 ${Math.round(m.signals.battery * 100)}%` : "";
  const pres = { online: "● live", background: "◐ locked", silent: "○ silent", offline: "○ offline" }[m.presence];
  const isSubject = view && currentSubject(view)?.id === m.id;
  return `<div class="mcard ${m.alert ? "alert" : m.risk.level}" data-id="${m.id}">
    <div class="av" style="--c:${m.color}">${esc(m.name.charAt(0).toUpperCase())}</div>
    <div class="mc-body">
      <div class="mc-head"><b>${esc(m.name)}</b>${m.simulated ? `<span class="tag">sim</span>` : `<span class="tag real">phone</span>`}${isSubject ? `<span class="tag story">story</span>` : ""}${statusPill(m)}</div>
      <div class="mc-line">${line}</div>
      <div class="mc-meta"><span class="pres ${m.presence}">${pres}</span>${bat ? `<span>${bat}</span>` : ""}${ci}</div>
    </div>
  </div>`;
}

function ladder(a: AlertState, now: number) {
  const steps = ["Friends alerted", "Bystander mode", "Emergency contact"];
  const next = a.nextEscalationAt ? Math.max(0, Math.ceil((a.nextEscalationAt - now) / 1000)) : null;
  return `<ol class="ladder">${steps
    .map((s, i) => {
      const lv = i + 1;
      const cls = a.stage > lv ? "done" : a.stage === lv ? "now" : "";
      const t = a.stage + 1 === lv && next !== null ? `<small>in ${next}s</small>` : "";
      return `<li class="${cls}"><span>L${lv}</span>${s}${t}</li>`;
    })
    .join("")}</ol>`;
}

function renderAlarm(v: GroupView) {
  const el = $("#alarm");
  const a = v.alerts[0];
  if (!a) {
    el.classList.add("hidden");
    patch(el, "");
    return;
  }
  el.classList.remove("hidden");
  const m = v.members.find((x) => x.id === a.memberId)!;
  const now = clock.now();
  const acks = a.acks.length ? `<div class="acks">🏃 ${a.acks.map((k) => `<b>${esc(k.byName)}</b> is on the way`).join(" · ")}${a.nextEscalationAt ? ` · ladder paused` : ""}</div>` : "";
  const sms = v.notifications.filter((n) => n.aboutMemberId === a.memberId && n.channel !== "push").at(-1);
  const smsCard = a.contactNotified && sms ? `<div class="sms"><div class="sms-h">💬 SMS → ${esc(sms.toName)} ${sms.simulated ? `<span class="tag">SIMULATED</span>` : `<span class="tag real">Twilio</span>`}</div><div class="sms-b">${esc(sms.body.slice(0, 150))}…</div></div>` : "";
  const ci = m.lastCheckin?.result && m.lastCheckin.outcome !== "ok" ? `<div class="heard">🎙 “${esc(m.lastCheckin.result.transcript.slice(0, 110))}” <small>${esc(engineLabel(m.lastCheckin.result))}</small></div>` : "";
  const others = v.alerts.slice(1).map((x) => `<span class="pill alert">${esc(x.memberName)} · L${x.stage}</span>`).join(" ");
  const html = `<div class="al-head"><div class="al-title">${esc(m.name.toUpperCase())} MAY NEED HELP</div>${others ? `<div class="al-more">Also: ${others}</div>` : ""}</div>
    <div class="al-reasons">${m.risk.reasons.map((r) => `<span class="chip">${esc(r.text)}</span>`).join("") || `<span class="chip">${esc(a.trigger)}</span>`}</div>
    ${ci}
    ${ladder(a, now)}
    ${acks}
    <div class="al-grid">
      <div class="al-box"><h4>Everyone else's phone</h4><p>${v.members.filter((x) => x.id !== m.id).map((x) => `<b style="color:${x.color}">${esc(x.name)}</b>`).join(", ") || "—"}: alarm + map + <i>I'm on my way</i></p></div>
      <div class="al-box"><h4>Medical (shown during alerts only)</h4><p>${esc(m.medical || "—")}</p></div>
      ${smsCard}
    </div>`;
  patch(el, html);
}

function renderSide(v: GroupView) {
  const subj = currentSubject(v);
  patch(
    $("#story"),
    STORY.map((s, i) => {
      const who = s.by === "friend" ? friendName(v, subj) : subj?.name ?? "";
      return `<li class="${i < step ? "done" : i === step ? "now" : ""}"><b>${i < step ? "✓" : i + 1}</b><div>${esc(s.label)}${who ? ` <span class="who">${esc(who)}</span>` : ""}<small>${esc(s.hint)}</small></div></li>`;
    }).join("") + (step >= STORY.length ? `<li class="end">Done. Shift+R to reset.</li>` : ""),
  );
  patch($("#subject"), subj ? `In trouble: <b style="color:${subj.color}">${esc(subj.name)}</b> ${subj.simulated ? "(simulated)" : "(real phone)"}` : "Waiting for members…");
  patch($("#foot"), `<span class="badge">AI: ${esc(v.engines.scorer.replace(/\s*\(.*\)/, ""))}</span> <span class="badge">answers: ${mode === "live" ? "real audio → AI" : "scripted"}</span> <span class="badge">L3: ${esc(v.engines.notifier)}</span>`);
}

const friendName = (v: GroupView, subj?: MemberView) => (v.members.find((m) => m !== subj && m.simulated) ?? v.members.find((m) => m !== subj))?.name ?? "";

let map: ReturnType<typeof createMap> | null = null;
let mode: "canned" | "live" = "canned";

function render(v: GroupView) {
  view = v;
  patch($("#gname"), esc(v.name));
  patch($("#join"), `<div><small>Join tonight's group</small><div class="code">${esc(v.code)}</div></div>${qrImg(v.links.joinUrl.replace(/^https?:\/\/[^/]+/, location.origin))}`);
  patch($("#cards"), v.members.map(card).join(""));
  if (!map) {
    map = createMap($("#map"));
    setTimeout(() => map?.invalidate(), 300);
    addEventListener("resize", () => map?.invalidate());
  }
  map.update(v);
  renderAlarm(v);
  renderSide(v);
  // Alarm sound while anyone is in alert.
  if (armed && v.alerts.length && !stopAlarm) stopAlarm = loopSound("alarm");
  if (!v.alerts.length && stopAlarm) {
    stopAlarm();
    stopAlarm = null;
    successChime();
  }
}

async function demo(action: string, body: Record<string, unknown> = {}) {
  try {
    return await api(`/api/groups/${code}/demo/${action}`, key, { target: view ? currentSubject(view)?.id : undefined, ...body });
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Let the room hear "what I manage to say" (Gemini-TTS clip), then submit it as the answer as the clip ends. */
async function slurredAloud() {
  const clip = new Audio("/demo-audio/slurred.wav");
  let delayMs = 2500;
  try {
    await new Promise<void>((res, rej) => {
      clip.onloadedmetadata = () => res();
      clip.onerror = () => rej(new Error("clip failed"));
      setTimeout(() => rej(new Error("clip timeout")), 3000);
    });
    await clip.play();
    delayMs = Math.min(14_000, Math.round(clip.duration * 1000) - 500);
  } catch {}
  await demo("slurred", { delayMs });
}

async function next() {
  if (!view || step >= STORY.length) return;
  const s = STORY[step++]!;
  renderSide(view);
  if (s.action === "walk") await demo("scene");
  if (s.action === "slurred") await slurredAloud();
  else await demo(s.action);
}

async function reset() {
  if (!confirm("Reset the demo for another run?")) return;
  step = 0;
  stopAlarm?.();
  stopAlarm = null;
  await demo("reset");
}

function arm() {
  if (armed) return;
  armed = true;
  unlockAudio();
  $("#arm").classList.add("hidden");
  if (view?.alerts.length && !stopAlarm) stopAlarm = loopSound("alarm");
}

function cycleSubject() {
  if (!view?.members.length) return;
  const ms = view.members;
  const i = ms.findIndex((m) => m.id === currentSubject(view!)?.id);
  subjectId = ms[(i + 1) % ms.length]!.id;
  void demo("subject", { target: subjectId });
  render(view);
}

function start() {
  shell();
  window.addEventListener("keydown", (e) => {
    arm();
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) {
      e.preventDefault();
      void next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      step = Math.max(0, step - 1);
      if (view) renderSide(view);
    } else if ((e.key === "R" || e.key === "r") && e.shiftKey) void reset();
    else if (e.key === "s" || e.key === "S") cycleSubject();
    else if (e.key === "a" || e.key === "A") {
      mode = mode === "canned" ? "live" : "canned";
      void demo("mode", { mode });
      if (view) renderSide(view);
    }
  });
  app.addEventListener("click", (e) => {
    arm();
    const c = (e.target as HTMLElement).closest<HTMLElement>(".mcard");
    if (c?.dataset.id && view) {
      subjectId = c.dataset.id;
      void demo("subject", { target: subjectId });
      render(view);
    }
  });
  connect({
    code,
    key,
    onView: render,
    onMsg: (m: ServerMsg) => {
      if (m.t === "ack") toast(`${m.ack.byName} is on the way to ${m.alert.memberName}`);
      if (m.t === "member") toast(`${m.name} ${m.event === "joined" ? "joined" : "left"} the group`);
    },
    onEnded: () => (app.innerHTML = `<div class="wrap"><h1>The night has ended</h1><p class="muted">All of the group's data was deleted.</p></div>`),
  });
  setInterval(() => view && renderAlarm(view), 500);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

if (!code || !key) app.innerHTML = `<div class="wrap"><h1>Missing group code or stage key</h1><p><a href="/">Create a stage demo</a></p></div>`;
else start();
