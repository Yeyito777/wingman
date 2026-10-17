// Shared browser helpers: API calls, the live session socket, sounds, formatting.

import type { LogEvent, ServerMsg, SessionView } from "../shared/types.ts";

// PWA manifest (added at runtime: the HTML bundler would try to resolve an absolute href).
if (!document.querySelector('link[rel="manifest"]')) {
  const l = document.createElement("link");
  l.rel = "manifest";
  l.href = "/manifest.webmanifest";
  document.head.append(l);
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** Replace an element's HTML only when it changed (so buttons aren't swapped out mid-tap); bind() runs after each swap. */
export function patch(el: HTMLElement | null, html: string, bind?: () => void) {
  if (!el || el.dataset.h === html) return false;
  el.dataset.h = html;
  el.innerHTML = html;
  bind?.();
  return true;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function api<T = any>(path: string, key: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof Uint8Array || body instanceof ArrayBuffer;
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...init,
    headers: {
      "x-wingman-key": key,
      ...(body !== undefined && !isRaw ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as any).error ?? `HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}

/** Live session view over WebSocket with automatic reconnect. */
export function connect(opts: { id: string; key: string; buddyId?: string; as?: string; onView: (v: SessionView) => void; onEnded: () => void }) {
  let ws: WebSocket | null = null;
  let tries = 0;
  let closed = false;
  const banner = document.createElement("div");
  banner.className = "conn hidden";
  banner.textContent = "Reconnecting…";
  document.body.append(banner);
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({ s: opts.id, k: opts.key });
    if (opts.buddyId) q.set("b", opts.buddyId);
    if (opts.as) q.set("as", opts.as);
    ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    ws.onopen = () => {
      tries = 0;
      banner.classList.add("hidden");
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMsg;
      if (msg.t === "view") {
        clock.sync(msg.view.now);
        opts.onView(msg.view);
      } else if (msg.t === "ended") {
        closed = true;
        opts.onEnded();
      }
    };
    ws.onclose = async () => {
      if (closed) return;
      banner.classList.remove("hidden");
      // Session gone? (server restarted or ended) -> stop retrying.
      const r = await fetch(`/api/s/${opts.id}`, { headers: { "x-wingman-key": opts.key } }).catch(() => null);
      if (r && r.status === 404) {
        closed = true;
        banner.classList.add("hidden");
        opts.onEnded();
        return;
      }
      setTimeout(open, Math.min(5000, 400 * 2 ** tries++));
    };
  };
  open();
  return { close: () => ((closed = true), ws?.close()) };
}

/** Server-clock offset so "2 min ago" and countdowns are right on every device. */
export const clock = {
  offset: 0,
  sync(serverNow: number) {
    this.offset = serverNow - Date.now();
  },
  now() {
    return Date.now() + this.offset;
  },
};

export function ago(t: number | null | undefined): string {
  if (!t) return "never";
  const s = Math.max(0, Math.round((clock.now() - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export function hhmmss(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtM(m: number | null | undefined) {
  if (m === null || m === undefined) return "—";
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function renderLog(el: HTMLElement, events: LogEvent[]) {
  el.innerHTML = [...events]
    .reverse()
    .map((e) => `<li><time>${hhmmss(e.at).replace(/\s?[AP]M/i, "")}</time><span class="${e.kind}">${esc(e.text)}</span></li>`)
    .join("");
}

export function toast(text: string, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- sound ----------

let ctx: AudioContext | null = null;

/** Must be called from a user gesture (iOS). Also unlocks speech synthesis. */
export function unlockAudio() {
  try {
    // Safari 16.4+: play through the speaker even when the ringer switch is on silent.
    (navigator as any).audioSession && ((navigator as any).audioSession.type = "playback");
  } catch {}
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.05);
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

export function audio() {
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, vol = 0.25, type: OscillatorType = "sine") {
  const c = audio();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function chime() {
  tone(880, 0, 0.35, 0.3);
  tone(1318.5, 0.16, 0.5, 0.3);
}

export function successChime() {
  tone(659, 0, 0.2, 0.25);
  tone(988, 0.12, 0.35, 0.25);
}

/** Looping sound until stop() is called. kind: "alarm" (buddy) or "siren" (bystander). */
export function loopSound(kind: "alarm" | "siren") {
  const c = audio();
  const g = c.createGain();
  g.gain.value = kind === "siren" ? 0.6 : 0.35;
  g.connect(c.destination);
  const o = c.createOscillator();
  o.type = kind === "siren" ? "sawtooth" : "square";
  o.connect(g);
  let t = c.currentTime;
  o.frequency.setValueAtTime(kind === "siren" ? 650 : 880, t);
  // Schedule ~2 minutes of modulation up front; re-arm with a timer.
  const schedule = () => {
    const end = c.currentTime + 120;
    t = Math.max(t, c.currentTime);
    while (t < end) {
      if (kind === "siren") {
        o.frequency.linearRampToValueAtTime(1450, t + 0.45);
        o.frequency.linearRampToValueAtTime(650, t + 0.9);
        t += 0.9;
      } else {
        o.frequency.setValueAtTime(988, t);
        g.gain.setValueAtTime(0.35, t);
        g.gain.setValueAtTime(0.0001, t + 0.14);
        o.frequency.setValueAtTime(740, t + 0.2);
        g.gain.setValueAtTime(0.35, t + 0.2);
        g.gain.setValueAtTime(0.0001, t + 0.34);
        t += 0.75;
      }
    }
  };
  schedule();
  const rearm = setInterval(schedule, 100_000);
  o.start();
  const vib = setInterval(() => navigator.vibrate?.([400, 150, 400]), 1200);
  return () => {
    clearInterval(rearm);
    clearInterval(vib);
    try {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      o.stop(c.currentTime + 0.05);
    } catch {}
    navigator.vibrate?.(0);
  };
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1;
    const voice = speechSynthesis.getVoices().find((v) => /en[-_](US|GB|CA)/i.test(v.lang) && /samantha|google|natural|female/i.test(v.name));
    if (voice) u.voice = voice;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    // iOS sometimes never fires onend.
    setTimeout(finish, 1200 + text.length * 75);
    speechSynthesis.speak(u);
  });
}

export function qrImg(text: string) {
  return `<div class="qr"><img alt="QR code" src="/api/qr?text=${encodeURIComponent(text)}"></div>`;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied");
  } catch {
    prompt("Copy this link", text);
  }
}
