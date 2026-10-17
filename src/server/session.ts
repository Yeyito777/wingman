// A night-out session: signals from the person's phone, buddies, AI check-ins, risk and the escalation ladder.
// Everything lives in memory only and is deleted when the session ends (or after 12 h).

import { AWAY_WATCH_M, CHECKIN_PROMPTS, DEFAULT_GEOFENCE_M, DEFAULT_VENUE, DEMO_TIMERS, PROBE_PROMPTS, REAL_TIMERS } from "../shared/config.ts";
import { haversineM, offset } from "../shared/geo.ts";
import type { Checkin, CheckinResult, Fix, LogEvent, Notification, Role, SessionView, Timers } from "../shared/types.ts";
import { initialEscalation, step, type Effect, type EscEvent, type EscState } from "./escalation.ts";
import type { Notifier } from "./notifier.ts";
import { assessRisk, type RiskInput } from "./risk.ts";
import { mockScore, scoreCheckin, type ScoreRequest } from "./scorer.ts";

export interface SessionSetup {
  name: string;
  phone?: string;
  pin: string;
  medical?: string;
  contactName?: string;
  contactPhone?: string;
  shareLocation?: "always" | "alert";
  demo?: boolean;
  /** minutes, as from Date#getTimezoneOffset() on the phone */
  tzOffset?: number;
}

export interface Buddy {
  id: string;
  name: string;
  joinedAt: number;
  fix: Fix | null;
  sockets: number;
}

interface Walk {
  startAt: number;
  from: { lat: number; lng: number };
  bearing: number;
  distM: number;
  durationMs: number;
}

export interface Hooks {
  notifier: Notifier;
  scorerName: string;
  broadcast(s: Session): void;
  /** scoring is injectable so tests can make it instant and deterministic */
  score?: (req: ScoreRequest) => Promise<CheckinResult>;
}

const STALE_BUDDY_FIX_MS = 3 * 60_000;
const MAX_EVENTS = 200;

export class Session {
  readonly id: string;
  readonly userKey: string;
  readonly inviteKey: string;
  readonly startedAt: number;
  status: "active" | "ended" = "active";
  demo: boolean;
  user: Required<Omit<SessionSetup, "pin" | "demo" | "tzOffset">>;
  private pin: string;
  tzOffset: number;
  timers: Timers;
  baseUrl = "";

  realFix: Fix | null = null;
  venue: Fix | null = null;
  venueIsDefault = false;
  geofenceM = DEFAULT_GEOFENCE_M;
  buddies = new Map<string, Buddy>();

  fallAt: number | null = null;
  lastMotionAt: number | null = null;
  lastInteractionAt: number | null = null;
  lastHeartbeatAt: number | null = null;
  battery: number | null = null;
  sensors = { motion: "unknown", location: "unknown", mic: "unknown" };
  clearedAt: number;
  awaySince: number | null = null;
  geofenceSince: number | null = null;
  walk: Walk | null = null;
  offlineSimulated = false;
  /** the phone said it was going to the background (screen locked / app switched) before going quiet */
  backgrounded = false;

  checkins: Checkin[] = [];
  lastCheckinAskedAt: number;
  esc: EscState;
  events: LogEvent[] = [];
  notifications: Notification[] = [];
  pinFails = 0;
  pinLockedUntil = 0;
  userSockets = 0;
  /** "canned": demo answers scored by the deterministic heuristic; "live": real audio through the AI engine */
  demoAnswerMode: "canned" | "live" = "canned";

  private seq = 0;
  private lastHash = "";

  constructor(setup: SessionSetup, private hooks: Hooks, now = Date.now()) {
    this.id = randomId(8);
    this.userKey = randomId(20);
    this.inviteKey = randomId(12);
    this.startedAt = now;
    this.clearedAt = now;
    this.lastCheckinAskedAt = now;
    this.demo = !!setup.demo;
    this.timers = { ...(this.demo ? DEMO_TIMERS : REAL_TIMERS) };
    this.pin = setup.pin;
    this.tzOffset = Number.isFinite(setup.tzOffset) ? setup.tzOffset! : new Date().getTimezoneOffset();
    this.user = {
      name: setup.name.trim().slice(0, 40) || "Your friend",
      phone: (setup.phone ?? "").trim().slice(0, 30),
      medical: (setup.medical ?? "").trim().slice(0, 600),
      contactName: (setup.contactName ?? "").trim().slice(0, 40) || "Emergency contact",
      contactPhone: (setup.contactPhone ?? "").trim().slice(0, 30),
      shareLocation: setup.shareLocation === "alert" ? "alert" : "always",
    };
    this.esc = initialEscalation(now);
    if (this.demo) this.setDefaultVenue();
    this.log("privacy", `${this.user.name} started a night out. Location is shared with buddies ${this.user.shareLocation === "always" ? "while the session is active" : "only if an alert fires"}; everything is deleted when the night ends.`, now);
  }

  // ---------- inputs ----------

  heartbeat(now: number, battery?: number | null) {
    if (this.offlineSimulated) return;
    this.lastHeartbeatAt = now;
    this.backgrounded = false;
    if (typeof battery === "number") this.battery = battery;
  }

  motion(now: number) {
    if (this.offlineSimulated) return;
    this.lastMotionAt = now;
  }

  interaction(now: number) {
    if (this.offlineSimulated) return;
    this.lastInteractionAt = now;
  }

  /** Screen locked / tab hidden: stop treating silence as alarming (browsers suspend background pages). */
  background(now: number) {
    if (this.offlineSimulated || this.backgrounded) return;
    this.backgrounded = true;
    this.lastHeartbeatAt = now;
    this.log("signal", `${this.user.name}'s phone went to the background (screen locked). Passive sensing pauses until it's back.`, now);
  }

  setSensors(s: Partial<Session["sensors"]>) {
    for (const k of ["motion", "location", "mic"] as const) if (typeof s[k] === "string") this.sensors[k] = String(s[k]).slice(0, 30);
  }

  fix(now: number, f: { lat: number; lng: number; accuracy: number }) {
    if (this.offlineSimulated) return;
    if (![f.lat, f.lng, f.accuracy].every(Number.isFinite)) return;
    this.realFix = { lat: f.lat, lng: f.lng, accuracy: f.accuracy, at: now };
    if ((!this.venue || this.venueIsDefault) && f.accuracy <= 200 && !this.walk) {
      this.venue = { ...this.realFix };
      this.venueIsDefault = false;
      this.log("info", `Venue set to where the night started (±${Math.round(f.accuracy)} m).`, now);
    }
  }

  fall(now: number, peakG: number | null, simulated = false) {
    this.fallAt = now;
    const g = peakG ? ` (impact ${peakG.toFixed(1)} g, then stillness)` : "";
    this.log("signal", `Possible fall detected${g}${simulated ? " [simulated]" : ""}.`, now);
  }

  buddyJoin(name: string, now: number): Buddy {
    const b: Buddy = { id: randomId(10), name: name.trim().slice(0, 30) || "Buddy", joinedAt: now, fix: null, sockets: 0 };
    this.buddies.set(b.id, b);
    this.log("info", `${b.name} joined as a buddy.`, now);
    return b;
  }

  buddyFix(id: string, now: number, f: { lat: number; lng: number; accuracy: number }) {
    const b = this.buddies.get(id);
    if (!b || ![f.lat, f.lng, f.accuracy].every(Number.isFinite)) return;
    b.fix = { lat: f.lat, lng: f.lng, accuracy: f.accuracy, at: now };
  }

  ack(buddyId: string, now: number) {
    const b = this.buddies.get(buddyId);
    if (!b) return false;
    this.dispatch({ type: "ack", now, by: b.name });
    return true;
  }

  escalate(by: string, now: number) {
    this.dispatch({ type: "escalate", now, by });
  }

  resolve(by: string, how: string, now: number) {
    this.dispatch({ type: "resolve", now, by, how });
  }

  /** PIN check for "I'm OK" in bystander mode; rate-limited so it can't be brute-forced. */
  checkPin(pin: string, now: number): { ok: boolean; lockedUntil?: number } {
    if (now < this.pinLockedUntil) return { ok: false, lockedUntil: this.pinLockedUntil };
    if (String(pin) === this.pin) {
      this.pinFails = 0;
      this.resolve(this.user.name, "PIN \"I'm OK\"", now);
      return { ok: true };
    }
    this.pinFails++;
    this.log("alert", `Wrong PIN entered on ${this.user.name}'s phone (${this.pinFails}).`, now);
    if (this.pinFails >= 3) {
      this.pinLockedUntil = now + 30_000;
      this.pinFails = 0;
      this.log("alert", "PIN locked for 30 s after 3 wrong attempts.", now);
    }
    return { ok: false, lockedUntil: this.pinLockedUntil > now ? this.pinLockedUntil : undefined };
  }

  // ---------- check-ins ----------

  get pendingCheckin(): Checkin | null {
    const c = this.checkins.at(-1);
    return c && c.status !== "done" ? c : null;
  }

  askCheckin(trigger: string, now: number, prompt?: string, timeoutMs = this.timers.checkinTimeoutMs): Checkin | null {
    if (this.pendingCheckin) return this.pendingCheckin;
    const scheduled = CHECKIN_PROMPTS[this.checkins.length % CHECKIN_PROMPTS.length]!;
    const c: Checkin = {
      id: randomId(8),
      prompt: prompt ?? scheduled,
      trigger,
      askedAt: now,
      deadline: now + timeoutMs,
      status: "pending",
    };
    this.checkins.push(c);
    if (this.checkins.length > 30) this.checkins.shift();
    this.lastCheckinAskedAt = now;
    this.log("checkin", `AI check-in sent to ${this.user.name}'s phone (${trigger}): "${c.prompt}"`, now);
    return c;
  }

  /** Accept an answer (audio or text) for a pending check-in and score it asynchronously. */
  async answerCheckin(id: string, ans: { audio?: { data: Uint8Array; mime: string }; text?: string; source: string; canned?: boolean }) {
    const c = this.checkins.find((x) => x.id === id);
    if (!c || c.status !== "pending") return { ok: false, error: "no pending check-in with that id" };
    c.status = "scoring";
    c.answeredAt = Date.now();
    this.log("checkin", `${this.user.name} answered (${ans.source}); scoring the reply…`, c.answeredAt);
    this.hooks.broadcast(this);
    const req: ScoreRequest = { question: c.prompt, name: this.user.name, audio: ans.audio, text: ans.text };
    let result: CheckinResult;
    if (ans.canned) {
      result = { ...mockScore(req), engine: "mock", model: "demo script", latencyMs: 0 };
    } else {
      result = await (this.hooks.score ?? scoreCheckin)(req);
    }
    if (this.status !== "active" || c.status !== "scoring") return { ok: false, error: "session changed" };
    this.finishCheckin(c, result, Date.now());
    return { ok: true, checkin: c };
  }

  private finishCheckin(c: Checkin, r: CheckinResult, now: number) {
    c.status = "done";
    c.result = r;
    c.outcome = !r.responded ? "missed" : r.coherent && r.impairment < 0.5 ? "ok" : "impaired";
    const eng = `${r.engine}${r.model ? ` · ${r.model}` : ""}${r.fallbackFrom ? " (fallback)" : ""}`;
    const said = r.transcript ? ` "${r.transcript.slice(0, 120)}"` : "";
    if (c.outcome === "ok") {
      this.log("ok", `Check-in OK:${said} → ${r.reason} [${eng}]`, now);
      this.resolve(this.user.name, "coherent check-in", now);
    } else if (c.outcome === "impaired") {
      this.log("alert", `Check-in sounded impaired (${Math.round(r.impairment * 100)}%):${said} → ${r.reason} [${eng}]`, now);
    } else {
      this.log("alert", `No intelligible answer to the check-in [${eng}].`, now);
    }
    this.evaluate(now);
  }

  missCheckin(c: Checkin, now: number) {
    c.status = "done";
    c.outcome = "missed";
    this.log("alert", `${this.user.name} missed a check-in (no answer within ${Math.round((c.deadline - c.askedAt) / 1000)} s).`, now);
  }

  // ---------- demo controls ----------

  startWalk(now: number, distM = 350, durationMs = 8000) {
    const from = this.position(now) ?? this.venue ?? { ...DEFAULT_VENUE, accuracy: 30, at: now };
    this.walk = { startAt: now, from: { lat: from.lat, lng: from.lng }, bearing: 55, distM, durationMs };
    this.log("signal", `${this.user.name} is walking away from the group [simulated].`, now);
  }

  stopWalk(now: number) {
    if (!this.walk) return;
    this.walk = null;
    this.awaySince = null;
    this.log("signal", `${this.user.name} is back with the group [simulated].`, now);
  }

  setOffline(on: boolean, now: number) {
    this.offlineSimulated = on;
    this.backgrounded = false;
    if (on) {
      // Make the dead-man's switch fire a few seconds from now rather than after the full timeout.
      this.lastHeartbeatAt = Math.min(this.lastHeartbeatAt ?? now, now - this.timers.heartbeatLostMs + 4000);
      this.log("signal", `${this.user.name}'s phone stopped reporting [simulated: battery died / phone taken].`, now);
    } else {
      this.lastHeartbeatAt = now;
      this.log("signal", `${this.user.name}'s phone is back online.`, now);
    }
  }

  reset(now: number) {
    this.fallAt = null;
    this.lastMotionAt = now;
    this.lastInteractionAt = now;
    this.lastHeartbeatAt = this.lastHeartbeatAt === null ? null : now;
    this.clearedAt = now;
    this.awaySince = null;
    this.geofenceSince = null;
    this.walk = null;
    this.offlineSimulated = false;
    this.checkins = [];
    this.lastCheckinAskedAt = now;
    this.esc = initialEscalation(now);
    this.events = [];
    this.notifications = [];
    this.pinFails = 0;
    this.pinLockedUntil = 0;
    this.log("info", "Session reset.", now);
  }

  setTimers(t: Partial<Timers> | "demo" | "real") {
    if (t === "demo") this.timers = { ...DEMO_TIMERS };
    else if (t === "real") this.timers = { ...REAL_TIMERS };
    else for (const [k, v] of Object.entries(t)) if (k in this.timers && Number.isFinite(v) && (v as number) >= 0) (this.timers as any)[k] = v;
  }

  // ---------- engine ----------

  /** Current position of the person: simulated walk, else the last real GPS fix. */
  position(now: number): Fix | null {
    if (this.walk) {
      const p = Math.min(1, (now - this.walk.startAt) / this.walk.durationMs);
      const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      return { ...offset(this.walk.from, this.walk.distM * ease, this.walk.bearing), accuracy: 8, at: now };
    }
    return this.realFix;
  }

  /** Where "the group" is: fresh, accurate buddy fixes (real sessions), else the venue. */
  group(now: number): { anchor: Fix; from: "group" | "venue" } | null {
    if (!this.demo) {
      const fresh = [...this.buddies.values()].map((b) => b.fix).filter((f): f is Fix => !!f && now - f.at < STALE_BUDDY_FIX_MS && f.accuracy <= 150);
      if (fresh.length) {
        const me = this.position(now);
        const nearest = me ? fresh.reduce((a, b) => (haversineM(me, a) <= haversineM(me, b) ? a : b)) : fresh[0]!;
        return { anchor: nearest, from: "group" };
      }
    }
    // On stage the buddies are "at the venue": a laptop's Wi-Fi geolocation is too imprecise to anchor on.
    return this.venue ? { anchor: this.venue, from: this.demo ? "group" : "venue" } : null;
  }

  distanceFromGroup(now: number): number | null {
    const me = this.position(now);
    const g = this.group(now);
    if (!me || !g || me.accuracy > 200) return null;
    // Conservative: subtract position uncertainty so GPS jitter indoors can't raise a false alarm.
    return Math.max(0, haversineM(me, g.anchor) - me.accuracy - Math.min(g.anchor.accuracy, 50));
  }

  riskInput(now: number): RiskInput {
    const away = this.distanceFromGroup(now);
    const g = this.group(now);
    const me = this.position(now);
    const outside = !!(me && this.venue && g?.from === "group" && !this.demo && haversineM(me, this.venue) - me.accuracy > this.geofenceM);
    return {
      now,
      timers: this.timers,
      sessionStartedAt: this.startedAt,
      clearedAt: this.clearedAt,
      fallAt: this.fallAt,
      lastMotionAt: this.lastMotionAt,
      lastInteractionAt: this.lastInteractionAt,
      // A phone that said "going to background" isn't a dead-man's-switch trigger; one that just died is.
      lastHeartbeatAt: this.backgrounded ? null : this.lastHeartbeatAt,
      awayM: away,
      awaySince: this.awaySince,
      awayFrom: g?.from ?? "venue",
      outsideGeofence: outside,
      geofenceSince: this.geofenceSince,
      checkins: this.checkins
        .filter((c) => c.status === "done" && c.outcome)
        .map((c) => ({ at: c.answeredAt ?? c.deadline, outcome: c.outcome!, impairment: c.result?.impairment ?? 1, reason: c.result?.reason ?? "" })),
      // Demo sessions are pinned to 11 PM so the storyline plays out identically at any time of day.
      localHour: this.demo ? 23 : new Date(now - this.tzOffset * 60_000).getUTCHours(),
    };
  }

  risk(now: number) {
    return assessRisk(this.riskInput(now));
  }

  /** Advance timers, recompute risk and step the escalation machine. Called by the global tick loop. */
  tick(now: number) {
    if (this.status !== "active") return;
    const pending = this.pendingCheckin;
    if (pending && pending.status === "pending" && now >= pending.deadline) this.missCheckin(pending, now);
    if (this.timers.checkinEveryMs > 0 && this.esc.stage === 0 && !this.pendingCheckin && now - this.lastCheckinAskedAt >= this.timers.checkinEveryMs) {
      this.askCheckin("scheduled", now);
    }
    // Track when drifts / geofence breaches started, so a later "all clear" can acknowledge them.
    const away = this.distanceFromGroup(now);
    if (away !== null && away >= AWAY_WATCH_M) this.awaySince ??= now;
    else this.awaySince = null;
    const ri = this.riskInput(now);
    if (ri.outsideGeofence) this.geofenceSince ??= now;
    else this.geofenceSince = null;
    this.evaluate(now);
  }

  private evaluate(now: number) {
    const risk = this.risk(now);
    this.dispatch({ type: "risk", now, risk });
    this.dispatch({ type: "tick", now });
    this.hooks.broadcast(this);
  }

  private dispatch(e: EscEvent) {
    const { state, effects } = step(this.esc, e, this.timers);
    this.esc = state;
    for (const fx of effects) this.apply(fx, e.now);
  }

  private apply(fx: Effect, now: number) {
    const name = this.user.name;
    switch (fx.type) {
      case "probe": {
        if (this.pendingCheckin) return;
        this.askCheckin(fx.reason === "alert" ? "alert" : `suspicion: ${fx.reason.replace(/_/g, " ")}`, now, PROBE_PROMPTS[fx.reason] ?? PROBE_PROMPTS.default);
        return;
      }
      case "alertBuddies":
        this.log("alert", `LEVEL 1 · Buddies alerted: ${name} may need help: ${this.risk(now).summary}.`, now);
        return;
      case "bystander":
        this.log("alert", `LEVEL 2 · Bystander mode on ${name}'s phone: siren, "This person may need help", medical info, Call 911.`, now);
        return;
      case "notifyContact":
        this.notifyContact(now);
        return;
      case "paused":
        this.log("ok", `${fx.by} is on the way. Escalation paused until ${clock(fx.until, this.tzOffset)}.`, now);
        return;
      case "resolved": {
        this.clearedAt = now;
        const p = this.pendingCheckin;
        if (p && p.status === "pending") {
          p.status = "done";
          p.outcome = undefined;
        }
        if (fx.fromStage > 0) this.log("ok", `Resolved by ${fx.by} (${fx.how}). Alert cleared from level ${fx.fromStage}.`, now);
        return;
      }
    }
  }

  private notifyContact(now: number) {
    const name = this.user.name;
    const pos = this.position(now);
    const risk = this.risk(now);
    const where = pos ? ` Last location: https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : "";
    const live = this.baseUrl ? ` Live: ${this.baseUrl}/buddy/${this.id}?k=${this.inviteKey}` : "";
    const body = `WINGMAN ALERT: ${name} may need help and isn't responding. ${cap(risk.summary)}.${where}${live} If you can't reach them, call 911.`;
    const speech = `This is Wingman. ${name} may need help and is not responding. ${risk.summary}. Check your text messages for their location.`;
    const to = this.user.contactPhone || "(no number set)";
    this.log("notify", `LEVEL 3 · Notifying emergency contact ${this.user.contactName} (${to}) via ${this.hooks.notifier.name === "twilio" ? "Twilio SMS" : "simulated SMS"}.`, now);
    if (!this.user.contactPhone) {
      this.notifications.push({ at: now, channel: "sms", to, toName: this.user.contactName, body, simulated: true, ok: false, detail: "no emergency contact number" });
      return;
    }
    this.hooks.notifier
      .send({ to: this.user.contactPhone, toName: this.user.contactName, body, speech })
      .then((ns) => {
        if (this.status !== "active") return;
        this.notifications.push(...ns);
        for (const n of ns) this.log("notify", `${n.channel.toUpperCase()} to ${n.toName}: ${n.ok ? "sent" : "FAILED"} (${n.detail}).`, Date.now());
        this.hooks.broadcast(this);
      })
      .catch((e) => console.error("[notifier]", e));
  }

  log(kind: LogEvent["kind"], text: string, at = Date.now()) {
    this.events.push({ id: ++this.seq, at, kind, text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  private setDefaultVenue() {
    this.venue = { ...DEFAULT_VENUE, accuracy: 30, at: this.startedAt };
    this.venueIsDefault = true;
  }

  // ---------- views ----------

  view(role: Role, now: number): SessionView {
    const risk = this.risk(now);
    const stage = this.esc.stage;
    const showLoc = role !== "buddy" || this.user.shareLocation === "always" || stage > 0;
    const showPrivate = role !== "buddy" || stage > 0;
    const pos = this.position(now);
    return {
      id: this.id,
      now,
      role,
      status: this.status,
      demo: this.demo,
      startedAt: this.startedAt,
      user: {
        name: this.user.name,
        phone: this.user.phone,
        medical: showPrivate ? this.user.medical : "",
        contactName: this.user.contactName,
        contactPhone: showPrivate ? this.user.contactPhone : mask(this.user.contactPhone),
        shareLocation: this.user.shareLocation,
      },
      timers: this.timers,
      risk,
      stage,
      stageSince: this.esc.stageSince,
      nextEscalationAt: this.esc.nextAt,
      acks: this.esc.acks,
      fix: showLoc ? pos : null,
      venue: showLoc ? this.venue : null,
      geofenceM: this.geofenceM,
      distanceFromGroupM: showLoc ? this.distanceFromGroup(now) : null,
      buddies: [...this.buddies.values()].map((b) => ({ id: b.id, name: b.name, online: b.sockets > 0, joinedAt: b.joinedAt, fix: b.fix })),
      checkin: this.pendingCheckin,
      checkins: this.checkins.slice(-6),
      signals: {
        fallAt: this.fallAt,
        lastMotionAt: this.lastMotionAt,
        lastInteractionAt: this.lastInteractionAt,
        lastHeartbeatAt: this.lastHeartbeatAt,
        battery: this.battery,
        sensors: this.sensors,
        offlineSimulated: this.offlineSimulated,
        backgrounded: this.backgrounded,
        walking: !!this.walk,
      },
      events: this.events.slice(-60),
      notifications: this.notifications.slice(-10),
      engines: { scorer: this.hooks.scorerName, notifier: this.hooks.notifier.name },
      inviteUrl: role !== "buddy" ? `${this.baseUrl}/buddy/${this.id}?k=${this.inviteKey}` : undefined,
      pinLockedUntil: this.pinLockedUntil > now ? this.pinLockedUntil : undefined,
      demoAnswerMode: role !== "buddy" ? this.demoAnswerMode : undefined,
    };
  }

  /** True when something visible changed since the last broadcast (ignoring the clock). */
  changed(now: number): boolean {
    const v = this.view("user", now);
    const h = JSON.stringify({ ...v, now: 0 });
    if (h === this.lastHash) return false;
    this.lastHash = h;
    return true;
  }
}

function randomId(n: number) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => a[b % a.length]).join("");
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

