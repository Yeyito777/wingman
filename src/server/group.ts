// A night-out group: every member is both guarded and a guardian.
// Each member has their own signals, check-ins, risk assessment and escalation ladder; when one member's ladder
// climbs, every other member is alerted. Everything lives in memory only and is deleted when the night ends.

import {
  AWAY_WATCH_M,
  CHECKIN_PROMPTS,
  DEFAULT_GEOFENCE_M,
  DEFAULT_VENUE,
  DEMO_TIMERS,
  GROUP_FIX_MAX_ACCURACY_M,
  GROUP_FIX_STALE_MS,
  MEMBER_COLORS,
  PROBE_PROMPTS,
  REAL_TIMERS,
} from "../shared/config.ts";
import { haversineM, offset } from "../shared/geo.ts";
import {
  DEEP_LINK_PREFIX,
  PROTOCOL_VERSION,
  type AlertState,
  type AppState,
  type Checkin,
  type CheckinResult,
  type Fix,
  type GroupLinks,
  type GroupView,
  type LatLng,
  type LogEvent,
  type MemberSetup,
  type MemberView,
  type MotionActivity,
  type Notification,
  type Presence,
  type PushTokenRequest,
  type SensorReport,
  type ServerMsg,
  type ShareLocation,
  type SignalBatch,
  type Timers,
} from "../shared/types.ts";
import { initialEscalation, step, type Effect, type EscEvent, type EscState } from "./escalation.ts";
import type { Notifier } from "./notifier.ts";
import type { Pusher } from "./push.ts";
import { assessRisk, type RiskInput } from "./risk.ts";
import { mockScore, scoreCheckin, type ScoreRequest } from "./scorer.ts";

export interface GroupHooks {
  notifier: Notifier;
  pusher: Pusher;
  scorerName: string;
  /** something visible may have changed: publish fresh views */
  broadcast(g: Group): void;
  /** discrete message: built per recipient (viewer member id, or null for the stage view) */
  send(g: Group, to: string[] | "all", build: (viewer: string | null) => ServerMsg): void;
  /** scoring is injectable so tests can make it instant and deterministic */
  score?: (req: ScoreRequest) => Promise<CheckinResult>;
}

interface Walk {
  startAt: number;
  from: LatLng;
  bearing: number;
  distM: number;
  durationMs: number;
}

const MAX_EVENTS = 300;

export const CANNED = {
  slurred: "Uhh... m'fine... I'm at the... the place wi' the... lights. I dunno... where's Sam...",
  coherent: "I'm at the Rex on Queen Street with everyone, we're heading home in about an hour.",
};

export class Member {
  readonly id = `m_${randomId(6)}`;
  readonly key = randomId(24);
  name: string;
  phone: string;
  pin: string;
  medical: string;
  contact: { name: string; phone: string };
  shareLocation: ShareLocation;
  tzOffset: number;
  joinedAt: number;
  color: string;
  simulated: boolean;
  pushToken: PushTokenRequest | null = null;

  realFix: Fix | null = null;
  fallAt: number | null = null;
  lastMotionAt: number | null = null;
  lastInteractionAt: number | null = null;
  lastHeartbeatAt: number | null = null;
  lastSeenAt: number | null = null;
  battery: number | null = null;
  charging: boolean | null = null;
  appState: AppState = "foreground";
  activity: MotionActivity | null = null;
  sensors: SensorReport = { motion: "unknown", location: "unknown", mic: "unknown", notifications: "unknown" };
  clearedAt: number;
  awaySince: number | null = null;
  geofenceSince: number | null = null;
  walk: Walk | null = null;
  offlineSimulated = false;
  checkins: Checkin[] = [];
  lastCheckinAskedAt: number;
  esc: EscState;
  pinFails = 0;
  pinLockedUntil = 0;
  sockets = 0;
  /** demo: a simulated member the storyline is driving answers no check-ins by itself */
  scripted = false;

  constructor(s: MemberSetup, now: number, color: string, simulated = false) {
    this.name = clean(s.name, 30) || "Friend";
    this.phone = clean(s.phone, 30);
    this.pin = String(s.pin);
    this.medical = clean(s.medical, 600);
    this.contact = { name: clean(s.emergencyContact?.name, 40) || "Emergency contact", phone: clean(s.emergencyContact?.phone, 30) };
    this.shareLocation = s.shareLocation === "alert" ? "alert" : "always";
    this.tzOffset = Number.isFinite(s.tzOffset) ? s.tzOffset! : new Date().getTimezoneOffset();
    this.joinedAt = now;
    this.clearedAt = now;
    this.lastCheckinAskedAt = now;
    this.color = color;
    this.simulated = simulated;
    this.esc = initialEscalation(now);
    if (s.pushToken?.token) this.pushToken = { kind: s.pushToken.kind === "apns" ? "apns" : "expo", token: String(s.pushToken.token).slice(0, 200), platform: s.pushToken.platform };
  }

  get pendingCheckin(): Checkin | null {
    const c = this.checkins.at(-1);
    return c && c.status !== "done" ? c : null;
  }

  get lastDoneCheckin(): Checkin | null {
    for (let i = this.checkins.length - 1; i >= 0; i--) if (this.checkins[i]!.status === "done" && this.checkins[i]!.outcome) return this.checkins[i]!;
    return null;
  }
}

export class Group {
  readonly code: string;
  readonly stageKey = randomId(24);
  readonly createdAt: number;
  name: string;
  status: "active" | "ended" = "active";
  demo: boolean;
  timers: Timers;
  baseUrl = "";
  members = new Map<string, Member>();
  venue: Fix | null = null;
  venueIsDefault = false;
  geofenceM = DEFAULT_GEOFENCE_M;
  events: LogEvent[] = [];
  notifications: Notification[] = [];
  /** demo: whose story the stage storyline is telling */
  demoSubjectId: string | null = null;
  /** demo: "canned" answers scored by the deterministic heuristic; "live" real audio through the AI engine */
  demoAnswerMode: "canned" | "live" = "canned";

  private seq = 0;
  private colorIdx = 0;
  private lastHash = "";

  constructor(code: string, opts: { name?: string; demo?: boolean }, readonly hooks: GroupHooks, now = Date.now()) {
    this.code = code;
    this.createdAt = now;
    this.demo = !!opts.demo;
    this.name = clean(opts.name, 60);
    this.timers = { ...(this.demo ? DEMO_TIMERS : REAL_TIMERS) };
    if (this.demo) {
      this.venue = { ...DEFAULT_VENUE, accuracy: 30, at: now };
      this.venueIsDefault = true;
    }
  }

  get links(): GroupLinks {
    return { joinUrl: `${this.baseUrl}/j/${this.code}`, deepLink: `${DEEP_LINK_PREFIX}${this.code}` };
  }

  // ---------- membership ----------

  addMember(setup: MemberSetup, now: number, simulated = false): Member {
    const m = new Member(setup, now, MEMBER_COLORS[this.colorIdx++ % MEMBER_COLORS.length]!, simulated);
    if (simulated) {
      m.sensors = { motion: "on", location: "on", mic: "on", notifications: "on" };
      m.lastHeartbeatAt = m.lastMotionAt = m.lastInteractionAt = m.lastSeenAt = now;
      m.battery = 0.4 + Math.random() * 0.5;
    }
    this.members.set(m.id, m);
    if (!this.name) this.name = `${m.name}'s night out`;
    const loc = m.shareLocation === "always" ? "shares location with the group all night" : "shares location only if an alert fires";
    this.log("privacy", `${m.name} joined${simulated ? " [simulated friend]" : ""}: guarded by everyone, guarding everyone. ${m.name} ${loc}; everything is deleted when the night ends.`, m.id, now);
    this.hooks.send(this, "all", () => ({ t: "member", event: "joined", memberId: m.id, name: m.name }));
    return m;
  }

  removeMember(m: Member, now: number) {
    this.members.delete(m.id);
    if (this.demoSubjectId === m.id) this.demoSubjectId = null;
    this.log("privacy", `${m.name} left the group; their data was deleted.`, undefined, now);
    this.hooks.send(this, "all", () => ({ t: "member", event: "left", memberId: m.id, name: m.name }));
  }

  memberByKey(key: string | null): Member | null {
    if (!key) return null;
    for (const m of this.members.values()) if (m.key === key) return m;
    return null;
  }

  // ---------- signals ----------

  signals(m: Member, b: SignalBatch, now: number) {
    if (m.offlineSimulated) return;
    m.lastSeenAt = now;
    if (b.appState === "foreground" || b.appState === "background" || b.appState === "locked") {
      if (b.appState !== m.appState && b.appState !== "foreground") {
        this.log("signal", `${m.name}'s phone went to the background (${b.appState}). Silence from it isn't treated as alarming.`, m.id, now);
      }
      m.appState = b.appState;
    }
    m.lastHeartbeatAt = now;
    if (typeof b.battery === "number" && Number.isFinite(b.battery)) m.battery = Math.max(0, Math.min(1, b.battery));
    if (typeof b.charging === "boolean") m.charging = b.charging;
    if (b.sensors && typeof b.sensors === "object") {
      for (const k of ["motion", "location", "mic", "notifications"] as const) {
        const v = b.sensors[k];
        if (v === "on" || v === "off" || v === "denied" || v === "unavailable" || v === "unknown") m.sensors[k] = v;
      }
    }
    if (b.fix && [b.fix.lat, b.fix.lng, b.fix.accuracy].every((x) => typeof x === "number" && Number.isFinite(x))) {
      this.setFix(m, { lat: b.fix.lat, lng: b.fix.lng, accuracy: b.fix.accuracy }, now);
    }
    if (b.motion && typeof b.motion === "object") {
      if (m.sensors.motion === "unknown") m.sensors.motion = "on";
      if (b.motion.moving) m.lastMotionAt = now;
      if (typeof b.motion.activity === "string") m.activity = b.motion.activity;
    }
    if (b.interaction) m.lastInteractionAt = now;
    if (b.fall && typeof b.fall === "object") this.fall(m, now, Number(b.fall.peakG) || null);
  }

  setFix(m: Member, f: { lat: number; lng: number; accuracy: number }, now: number) {
    m.realFix = { ...f, at: now };
    if ((!this.venue || this.venueIsDefault) && f.accuracy <= 200 && !m.walk && !m.simulated) {
      this.venue = { ...m.realFix };
      this.venueIsDefault = false;
      this.log("info", `Venue set to where the night started (±${Math.round(f.accuracy)} m, from ${m.name}'s phone).`, undefined, now);
    }
  }

  fall(m: Member, now: number, peakG: number | null, simulated = false) {
    m.fallAt = now;
    m.lastMotionAt = now;
    const g = peakG ? ` (impact ${peakG.toFixed(1)} g, then stillness)` : "";
    this.log("signal", `Possible fall detected on ${m.name}'s phone${g}${simulated ? " [simulated]" : ""}.`, m.id, now);
    this.evaluate(m, now);
  }

  // ---------- guardian actions ----------

  ack(target: Member, by: Member, now: number) {
    this.dispatch(target, { type: "ack", now, by: by.id, byName: by.name });
  }

  escalate(target: Member, byName: string, now: number) {
    this.dispatch(target, { type: "escalate", now, by: byName });
  }

  resolve(target: Member, by: string, how: string, now: number) {
    this.dispatch(target, { type: "resolve", now, by, how });
  }

  /** "I'm OK" with the member's own PIN; rate-limited so it can't be brute-forced. */
  checkPin(m: Member, pin: string, now: number): { ok: boolean; lockedUntil?: number; attemptsLeft?: number } {
    if (now < m.pinLockedUntil) return { ok: false, lockedUntil: m.pinLockedUntil };
    if (String(pin) === m.pin) {
      m.pinFails = 0;
      this.resolve(m, m.name, `PIN "I'm OK"`, now);
      return { ok: true };
    }
    m.pinFails++;
    this.log("alert", `Wrong PIN entered on ${m.name}'s phone (${m.pinFails}).`, m.id, now);
    if (m.pinFails >= 3) {
      m.pinLockedUntil = now + 30_000;
      m.pinFails = 0;
      this.log("alert", `PIN locked for 30 s after 3 wrong attempts on ${m.name}'s phone.`, m.id, now);
      return { ok: false, lockedUntil: m.pinLockedUntil };
    }
    return { ok: false, attemptsLeft: 3 - m.pinFails };
  }

  // ---------- check-ins ----------

  askCheckin(m: Member, trigger: string, now: number, prompt?: string, timeoutMs = this.timers.checkinTimeoutMs): Checkin {
    if (m.pendingCheckin) return m.pendingCheckin;
    const c: Checkin = {
      id: `c_${randomId(6)}`,
      prompt: clean(prompt, 200) || CHECKIN_PROMPTS[m.checkins.length % CHECKIN_PROMPTS.length]!,
      trigger,
      askedAt: now,
      deadline: now + timeoutMs,
      status: "pending",
      autoListen: !this.demo || trigger === "manual",
    };
    m.checkins.push(c);
    if (m.checkins.length > 30) m.checkins.shift();
    m.lastCheckinAskedAt = now;
    this.log("checkin", `AI check-in sent to ${m.name}'s phone (${trigger}): "${c.prompt}"`, m.id, now);
    this.hooks.send(this, [m.id], () => ({ t: "checkin", checkin: c }));
    this.push(m, "Wingman check-in", c.prompt, { type: "checkin", code: this.code, memberId: m.id, checkinId: c.id });
    if (m.simulated && !m.scripted) {
      // Simulated friends answer like a sober friend would.
      setTimeout(() => {
        if (c.status === "pending" && this.members.has(m.id)) void this.answerCheckin(m, c.id, { text: CANNED.coherent, source: "simulated friend", canned: true });
      }, 1500);
    }
    return c;
  }

  /** Accept an answer (audio or text) for a pending check-in and score it. */
  async answerCheckin(m: Member, id: string, ans: { audio?: { data: Uint8Array; mime: string }; text?: string; source: string; canned?: boolean }) {
    const c = m.checkins.find((x) => x.id === id);
    if (!c || c.status !== "pending") return { ok: false, error: "no pending check-in with that id" };
    c.status = "scoring";
    c.answeredAt = Date.now();
    m.lastInteractionAt = c.answeredAt;
    this.log("checkin", `${m.name} answered (${ans.source}); scoring the reply…`, m.id, c.answeredAt);
    this.hooks.broadcast(this);
    const req: ScoreRequest = { question: c.prompt, name: m.name, audio: ans.audio, text: ans.text };
    // (When both audio and text are present, AI engines listen to the audio; the offline heuristic reads the text.)
    const result: CheckinResult = ans.canned
      ? { ...mockScore(req), engine: "mock", model: "demo script", latencyMs: 0 }
      : await (this.hooks.score ?? scoreCheckin)(req);
    if (this.status !== "active" || c.status !== "scoring" || !this.members.has(m.id)) return { ok: false, error: "check-in was cleared while scoring" };
    this.finishCheckin(m, c, result, Date.now());
    return { ok: true, checkin: c };
  }

  private finishCheckin(m: Member, c: Checkin, r: CheckinResult, now: number) {
    c.status = "done";
    c.result = r;
    c.outcome = !r.responded ? "missed" : r.coherent && r.impairment < 0.5 ? "ok" : "impaired";
    const eng = `${r.engine}${r.model ? ` · ${r.model}` : ""}${r.fallbackFrom ? " (fallback)" : ""}`;
    const said = r.transcript ? ` "${r.transcript.slice(0, 120)}"` : "";
    if (c.outcome === "ok") {
      this.log("ok", `${m.name}'s check-in OK:${said} → ${r.reason} [${eng}]`, m.id, now);
      this.resolve(m, m.name, "coherent check-in", now);
    } else if (c.outcome === "impaired") {
      this.log("alert", `${m.name}'s check-in sounded impaired (${Math.round(r.impairment * 100)}%):${said} → ${r.reason} [${eng}]`, m.id, now);
    } else {
      this.log("alert", `No intelligible answer from ${m.name} [${eng}].`, m.id, now);
    }
    this.evaluate(m, now);
  }

  private missCheckin(m: Member, c: Checkin, now: number) {
    c.status = "done";
    c.outcome = "missed";
    this.log("alert", `${m.name} missed a check-in (no answer within ${Math.round((c.deadline - c.askedAt) / 1000)} s).`, m.id, now);
  }

  // ---------- demo controls ----------

  startWalk(m: Member, now: number, distM = 350, durationMs = 8000) {
    const from = this.position(m, now) ?? this.venue ?? { ...DEFAULT_VENUE, accuracy: 30, at: now };
    m.walk = { startAt: now, from: { lat: from.lat, lng: from.lng }, bearing: 55, distM, durationMs };
    this.log("signal", `${m.name} is walking away from the group [simulated].`, m.id, now);
  }

  stopWalk(m: Member, now: number) {
    if (!m.walk) return;
    m.walk = null;
    m.awaySince = null;
    this.log("signal", `${m.name} is back with the group [simulated].`, m.id, now);
  }

  setOffline(m: Member, on: boolean, now: number) {
    m.offlineSimulated = on;
    m.appState = "foreground";
    if (on) {
      // Make the dead-man's switch fire a few seconds from now rather than after the full timeout.
      m.lastHeartbeatAt = Math.min(m.lastHeartbeatAt ?? now, now - this.timers.heartbeatLostMs + 4000);
      this.log("signal", `${m.name}'s phone stopped reporting [simulated: battery died / phone taken].`, m.id, now);
    } else {
      m.lastHeartbeatAt = now;
      this.log("signal", `${m.name}'s phone is back online.`, m.id, now);
    }
  }

  /** Start a new demo "scene" for a member: earlier signals count as cleared and a pending check-in is dropped. */
  newScene(m: Member, now: number) {
    dropPending(m);
    m.clearedAt = now;
    m.fallAt = null;
    m.lastMotionAt = now;
    m.lastInteractionAt = now;
  }

  /** Demo reset: every member back to a clean slate (members stay connected), log cleared. */
  reset(now: number) {
    for (const m of this.members.values()) {
      m.fallAt = null;
      m.lastMotionAt = m.lastInteractionAt = now;
      if (m.lastHeartbeatAt !== null) m.lastHeartbeatAt = now;
      m.clearedAt = now;
      m.awaySince = m.geofenceSince = null;
      m.walk = null;
      m.offlineSimulated = false;
      m.checkins = [];
      m.lastCheckinAskedAt = now;
      m.esc = initialEscalation(now);
      m.pinFails = 0;
      m.pinLockedUntil = 0;
      m.scripted = false;
    }
    // Re-anchor the venue on a real phone, so simulated friends stand right next to it.
    const real = [...this.members.values()].find((m) => !m.simulated && m.realFix && m.realFix.accuracy <= 200);
    if (real?.realFix) this.venue = { ...real.realFix };
    this.events = [];
    this.notifications = [];
    this.log("info", "Demo reset.", undefined, now);
  }

  setTimers(t: Partial<Timers> | "demo" | "real") {
    if (t === "demo") this.timers = { ...DEMO_TIMERS };
    else if (t === "real") this.timers = { ...REAL_TIMERS };
    else for (const [k, v] of Object.entries(t)) if (k in this.timers && Number.isFinite(v) && (v as number) >= 0) (this.timers as any)[k] = v;
  }

  // ---------- engine ----------

  /** Where a member is: simulated walk, a simulated friend standing at the venue, else their last real fix. */
  position(m: Member, now: number): Fix | null {
    if (m.walk) {
      const p = Math.min(1, (now - m.walk.startAt) / m.walk.durationMs);
      const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      return { ...offset(m.walk.from, m.walk.distM * ease, m.walk.bearing), accuracy: 8, at: now };
    }
    if (m.simulated) {
      if (!this.venue) return null;
      // Mill around within a few metres of the venue, each friend on their own little circle.
      const i = [...this.members.keys()].indexOf(m.id);
      const angle = (i * 120 + (now / 1000) * 2) % 360;
      return { ...offset(this.venue, 12 + (i % 4) * 9, angle), accuracy: 10, at: now };
    }
    return m.realFix;
  }

  /** The other members' usable positions (fresh and accurate enough). */
  private otherFixes(m: Member, now: number): { member: Member; fix: Fix }[] {
    const out: { member: Member; fix: Fix }[] = [];
    for (const o of this.members.values()) {
      if (o === m || o.offlineSimulated) continue;
      const f = this.position(o, now);
      if (f && now - f.at < GROUP_FIX_STALE_MS && f.accuracy <= GROUP_FIX_MAX_ACCURACY_M) out.push({ member: o, fix: f });
    }
    return out;
  }

  /** Distance from the group: to the nearest other member (beyond GPS uncertainty), or the venue if alone. */
  distance(m: Member, now: number): { awayM: number | null; nearestId: string | null; centroidM: number | null; from: "group" | "venue" } {
    const me = this.position(m, now);
    const none = { awayM: null, nearestId: null, centroidM: null, from: "group" as const };
    if (!me || me.accuracy > 200) return none;
    const beyond = (a: Fix, b: { accuracy: number }, d: number) => Math.max(0, d - a.accuracy - Math.min(b.accuracy, 50));
    const others = this.otherFixes(m, now);
    if (others.length) {
      let best = others[0]!;
      let bestD = haversineM(me, best.fix);
      for (const o of others.slice(1)) {
        const d = haversineM(me, o.fix);
        if (d < bestD) (best = o), (bestD = d);
      }
      const c = { lat: avg(others.map((o) => o.fix.lat)), lng: avg(others.map((o) => o.fix.lng)) };
      return { awayM: beyond(me, best.fix, bestD), nearestId: best.member.id, centroidM: beyond(me, { accuracy: 0 }, haversineM(me, c)), from: "group" };
    }
    if (this.venue) return { awayM: beyond(me, this.venue, haversineM(me, this.venue)), nearestId: null, centroidM: null, from: "venue" };
    return none;
  }

  riskInput(m: Member, now: number): RiskInput {
    const d = this.distance(m, now);
    const me = this.position(m, now);
    const outside = !!(me && this.venue && d.from === "group" && !this.demo && haversineM(me, this.venue) - me.accuracy > this.geofenceM);
    return {
      now,
      timers: this.timers,
      sessionStartedAt: m.joinedAt,
      clearedAt: m.clearedAt,
      fallAt: m.fallAt,
      // Without a working motion sensor, "no movement" means nothing: don't let it count as stillness.
      lastMotionAt: m.sensors.motion === "on" ? m.lastMotionAt : now,
      lastInteractionAt: m.lastInteractionAt,
      // A phone that said "going to background" isn't a dead-man's-switch trigger; one that just died is.
      lastHeartbeatAt: m.appState !== "foreground" ? null : m.lastHeartbeatAt,
      awayM: d.awayM,
      awaySince: m.awaySince,
      awayFrom: d.from,
      outsideGeofence: outside,
      geofenceSince: m.geofenceSince,
      checkins: m.checkins
        .filter((c) => c.status === "done" && c.outcome)
        .map((c) => ({ at: c.answeredAt ?? c.deadline, outcome: c.outcome!, impairment: c.result?.impairment ?? 1, reason: c.result?.reason ?? "" })),
      // Demo groups are pinned to 11 PM so the storyline plays out identically at any time of day.
      localHour: this.demo ? 23 : new Date(now - m.tzOffset * 60_000).getUTCHours(),
    };
  }

  risk(m: Member, now: number) {
    return assessRisk(this.riskInput(m, now));
  }

  /** Advance every member's timers, recompute risk and step their ladders. Called by the global tick loop. */
  tick(now: number) {
    if (this.status !== "active") return;
    for (const m of this.members.values()) {
      if (m.simulated && !m.offlineSimulated) {
        m.lastHeartbeatAt = m.lastSeenAt = now;
        if (!m.fallAt) m.lastMotionAt = now;
        m.lastInteractionAt = now;
      }
      const pending = m.pendingCheckin;
      if (pending && pending.status === "pending" && now >= pending.deadline) this.missCheckin(m, pending, now);
      if (this.timers.checkinEveryMs > 0 && m.esc.stage === 0 && !m.pendingCheckin && now - m.lastCheckinAskedAt >= this.timers.checkinEveryMs) {
        this.askCheckin(m, "scheduled", now);
      }
      // Track when drifts / geofence breaches started, so a later "all clear" can acknowledge them.
      const ri = this.riskInput(m, now);
      if (ri.awayM !== null && ri.awayM >= AWAY_WATCH_M) m.awaySince ??= now;
      else m.awaySince = null;
      if (ri.outsideGeofence) m.geofenceSince ??= now;
      else m.geofenceSince = null;
      this.step(m, now);
    }
    this.hooks.broadcast(this);
  }

  private evaluate(m: Member, now: number) {
    this.step(m, now);
    this.hooks.broadcast(this);
  }

  private step(m: Member, now: number) {
    this.dispatch(m, { type: "risk", now, risk: this.risk(m, now) });
    this.dispatch(m, { type: "tick", now });
  }

  private dispatch(m: Member, e: EscEvent) {
    const { state, effects } = step(m.esc, e, this.timers);
    m.esc = state;
    for (const fx of effects) this.apply(m, fx, e.now);
  }

  private apply(m: Member, fx: Effect, now: number) {
    const others = [...this.members.values()].filter((o) => o !== m);
    switch (fx.type) {
      case "probe": {
        if (m.pendingCheckin) return;
        this.askCheckin(m, fx.reason === "alert" ? "alert" : `suspicion: ${fx.reason.replace(/_/g, " ")}`, now, PROBE_PROMPTS[fx.reason] ?? PROBE_PROMPTS.default);
        return;
      }
      case "alertGroup": {
        const risk = this.risk(m, now);
        const why = risk.reasons.length ? risk.summary : `alert raised ${fx.trigger}`;
        const names = others.map((o) => o.name).join(", ") || "nobody else in the group yet";
        this.log("alert", `LEVEL 1 · ${m.name} may need help: ${why}. Alerting ${names}.`, m.id, now);
        this.announce(m, `${m.name} may need help`, cap(why));
        return;
      }
      case "bystander":
        this.log("alert", `LEVEL 2 · Bystander mode on ${m.name}'s phone: siren, "This person may need help", medical info, Call 911.`, m.id, now);
        this.announce(m, `${m.name}'s phone is asking strangers for help`, "Nobody has responded yet. Bystander mode is on: siren and medical info.");
        return;
      case "notifyContact":
        this.notifyContact(m, now);
        this.announce(m, `${m.name}'s emergency contact was notified`, `${m.contact.name} got a text with ${m.name}'s location.`);
        return;
      case "paused": {
        this.log("ok", `${fx.ack.byName} is on the way to ${m.name}. Escalation paused until ${clock(fx.until, m.tzOffset)}.`, m.id, now);
        const alert = this.alertState(m)!;
        this.hooks.send(this, "all", (v) => ({ t: "ack", alert, ack: fx.ack, you: v === m.id }));
        for (const o of others) if (o.id !== fx.ack.by) this.push(o, `${fx.ack.byName} is on the way to ${m.name}`, "Escalation paused.", { type: "ack", code: this.code, memberId: m.id });
        return;
      }
      case "resolved": {
        m.clearedAt = now;
        dropPending(m);
        if (fx.fromStage > 0) {
          this.log("ok", `${m.name} is OK: resolved by ${fx.by} (${fx.how}). Alert cleared from level ${fx.fromStage}.`, m.id, now);
          this.hooks.send(this, "all", (v) => ({ t: "resolved", memberId: m.id, memberName: m.name, by: fx.by, how: fx.how, fromStage: fx.fromStage, you: v === m.id }));
          for (const o of others) this.push(o, `${m.name} is OK`, `Resolved by ${fx.by} (${fx.how}).`, { type: "resolved", code: this.code, memberId: m.id });
        }
        return;
      }
    }
  }

  /** Fan an alert stage out to every member (and the stage view); push to backgrounded phones. */
  private announce(m: Member, title: string, body: string) {
    const alert = this.alertState(m);
    if (!alert) return;
    this.hooks.send(this, "all", (v) => ({
      t: "alert",
      alert,
      you: v === m.id,
      title: v === m.id ? (alert.stage >= 2 ? "Bystander mode is on" : "Your friends were alerted") : title,
      body: v === m.id ? "If you're OK, enter your PIN or answer the check-in." : body,
    }));
    for (const o of this.members.values()) {
      if (o === m) {
        if (alert.stage === 2) this.push(o, "Are you OK?", "Bystander mode is on. Enter your PIN if you're OK.", { type: "alert", code: this.code, memberId: m.id });
      } else this.push(o, title, body, { type: "alert", code: this.code, memberId: m.id, stage: alert.stage });
    }
  }

  private push(to: Member, title: string, body: string, data: Record<string, unknown>) {
    if (!to.pushToken || to.simulated || to.appState === "foreground" || this.hooks.pusher.name === "none") return;
    const token = to.pushToken;
    this.hooks.pusher
      .send({ token, title, body, data })
      .then((r) => {
        this.notifications.push({ at: Date.now(), channel: "push", to: token.token.slice(0, 24) + "…", toName: to.name, aboutMemberId: String(data.memberId ?? to.id), body: `${title}: ${body}`, simulated: false, ok: r.ok, detail: r.detail });
      })
      .catch((e) => console.error("[push]", e));
  }

  private notifyContact(m: Member, now: number) {
    const pos = this.position(m, now);
    const risk = this.risk(m, now);
    const where = pos ? ` Last location: https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : "";
    const why = risk.reasons.length ? risk.summary : "a friend raised the alert";
    const friends = [...this.members.values()].filter((o) => o !== m).map((o) => o.name);
    const fr = friends.length ? ` Their friends (${friends.join(", ")}) have been alerted but nobody has reached them yet.` : "";
    const body = `WINGMAN ALERT: ${m.name} may need help and isn't responding. ${cap(why)}.${where}${fr} If you can't reach them, call 911.`;
    const speech = `This is Wingman. ${m.name} may need help and is not responding. ${why}. Check your text messages for their location.`;
    const to = m.contact.phone || "(no number set)";
    this.log("notify", `LEVEL 3 · Notifying ${m.name}'s emergency contact ${m.contact.name} (${to}) via ${this.hooks.notifier.name === "twilio" ? "Twilio SMS" : "simulated SMS"}.`, m.id, now);
    if (!m.contact.phone) {
      this.notifications.push({ at: now, channel: "sms", to, toName: m.contact.name, aboutMemberId: m.id, body, simulated: true, ok: false, detail: "no emergency contact number" });
      return;
    }
    this.hooks.notifier
      .send({ to: m.contact.phone, toName: m.contact.name, body, speech })
      .then((ns) => {
        if (this.status !== "active") return;
        this.notifications.push(...ns.map((n) => ({ ...n, aboutMemberId: m.id })));
        for (const n of ns) this.log("notify", `${n.channel.toUpperCase()} to ${n.toName}: ${n.ok ? "sent" : "FAILED"} (${n.detail}).`, m.id, Date.now());
        this.hooks.broadcast(this);
      })
      .catch((e) => console.error("[notifier]", e));
  }

  log(kind: LogEvent["kind"], text: string, memberId?: string, at = Date.now()) {
    this.events.push({ id: ++this.seq, at, kind, memberId, text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  // ---------- views ----------

  alertState(m: Member): AlertState | null {
    const e = m.esc;
    if (e.stage === 0) return null;
    return {
      memberId: m.id,
      memberName: m.name,
      stage: e.stage,
      stageSince: e.stageSince,
      startedAt: e.startedAt ?? e.stageSince,
      nextEscalationAt: e.nextAt,
      trigger: e.trigger,
      acks: e.acks,
      bystander: e.stage >= 2,
      contactNotified: e.stage >= 3,
    };
  }

  presence(m: Member, now: number): Presence {
    if (m.offlineSimulated) return "silent";
    if (m.lastHeartbeatAt === null && m.sockets === 0) return "offline";
    if (m.appState !== "foreground") return "background";
    if (m.sockets > 0 || m.simulated) return m.lastHeartbeatAt !== null && now - m.lastHeartbeatAt >= this.timers.heartbeatLostMs ? "silent" : "online";
    if (m.lastHeartbeatAt !== null && now - m.lastHeartbeatAt < this.timers.heartbeatLostMs) return "online";
    return "silent";
  }

  memberView(m: Member, viewer: string | null, now: number): MemberView {
    const self = viewer === m.id;
    const alert = this.alertState(m);
    const reveal = self || alert !== null;
    const showLoc = self || m.shareLocation === "always" || alert !== null;
    const d = this.distance(m, now);
    const last = m.lastDoneCheckin;
    const pending = m.pendingCheckin;
    const hide = (c: Checkin | null): Checkin | null => (!c || reveal || !c.result ? c : { ...c, result: { ...c.result, transcript: "" } });
    const v: MemberView = {
      id: m.id,
      name: m.name,
      color: m.color,
      isYou: self,
      simulated: m.simulated,
      joinedAt: m.joinedAt,
      presence: this.presence(m, now),
      lastSeenAt: m.lastSeenAt,
      fix: showLoc ? this.position(m, now) : null,
      distanceFromGroupM: showLoc ? d.awayM : null,
      nearestMemberId: showLoc ? d.nearestId : null,
      distanceFromCentroidM: showLoc ? d.centroidM : null,
      risk: this.risk(m, now),
      alert,
      checkin: pending,
      lastCheckin: hide(last),
      signals: {
        lastHeartbeatAt: m.lastHeartbeatAt,
        battery: m.battery,
        charging: m.charging,
        appState: m.appState,
        fallAt: m.fallAt,
        lastMotionAt: m.lastMotionAt,
        lastInteractionAt: m.lastInteractionAt,
        activity: m.activity,
        sensors: { ...m.sensors },
      },
      shareLocation: m.shareLocation,
      phone: m.phone,
      medical: reveal ? m.medical : "",
      emergencyContact: { name: m.contact.name, phone: reveal ? m.contact.phone : mask(m.contact.phone) },
    };
    if (self) {
      if (m.pinLockedUntil > now) v.pinLockedUntil = m.pinLockedUntil;
      v.hasPushToken = !!m.pushToken;
    }
    return v;
  }

  /** The group as seen by one member (viewer = member id) or by the stage view (viewer = null). */
  view(viewer: string | null, now: number): GroupView {
    const ms = [...this.members.values()];
    const me = viewer ? ms.find((m) => m.id === viewer) : undefined;
    const ordered = me ? [me, ...ms.filter((m) => m !== me)] : ms;
    const members = ordered.map((m) => this.memberView(m, viewer, now));
    const alerts = members
      .map((m) => m.alert)
      .filter((a): a is AlertState => a !== null)
      .sort((a, b) => b.stage - a.stage || a.startedAt - b.startedAt);
    return {
      protocolVersion: PROTOCOL_VERSION,
      code: this.code,
      name: this.name,
      now,
      status: this.status,
      demo: this.demo,
      createdAt: this.createdAt,
      you: me ? me.id : null,
      members,
      alerts,
      timers: this.timers,
      links: this.links,
      events: this.events.slice(-80),
      notifications: this.notifications.slice(-12),
      engines: { scorer: this.hooks.scorerName, notifier: this.hooks.notifier.name, push: this.hooks.pusher.name },
    };
  }

  /** True when something visible changed since the last call (ignoring the clock). */
  changed(now: number): boolean {
    const v = this.view(null, now);
    const h = JSON.stringify({ ...v, now: 0, x: [...this.members.values()].map((m) => [m.pinLockedUntil > now, !!m.pushToken, m.medical, m.contact.phone]) });
    if (h === this.lastHash) return false;
    this.lastHash = h;
    return true;
  }
}

function dropPending(m: Member) {
  const p = m.pendingCheckin;
  if (p && p.status === "pending") {
    p.status = "done";
    p.outcome = undefined;
  }
}

export function randomId(n: number) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => a[b % a.length]).join("");
}

function clean(s: unknown, max: number) {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

function avg(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function mask(p: string) {
  return p ? p.replace(/\d(?=\d{2})/g, "•") : "";
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clock(t: number, tzOffset: number) {
  const d = new Date(t - tzOffset * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}
