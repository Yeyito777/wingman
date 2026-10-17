// Wingman wire protocol: the contract between the server and every client (iPhone app, stage view, web fallback).
// Plain TypeScript, no runtime imports: safe to import from Bun, React Native / Expo, and the browser.
// See docs/PROTOCOL.md for endpoints, auth, lifecycle and examples. Bump PROTOCOL_VERSION on any breaking change.
//
// Model: a fully connected group. Every member is both guarded and a guardian. Each member's signals feed their own
// risk engine; when one member's risk escalates, every OTHER member is alerted (L1), then bystander mode runs on the
// affected member's phone (L2), then that member's emergency contact is notified (L3). Several members can be in
// alert at once.

export const PROTOCOL_VERSION = 1;

/** Join codes: 6 chars from this alphabet (no 0/O/1/I/L), case-insensitive on input. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;
export const DEEP_LINK_PREFIX = "wingman://join/";

// ---------------------------------------------------------------- primitives

/** Milliseconds since the Unix epoch (server clock). Compare against GroupView.now, not the device clock. */
export type Millis = number;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Fix extends LatLng {
  /** metres, 1-sigma horizontal accuracy as reported by the OS */
  accuracy: number;
  /** server receive time */
  at: Millis;
}

export type RiskLevel = "ok" | "watch" | "alert";

export type RiskReasonCode =
  | "fall"
  | "stillness"
  | "missed_checkin"
  | "impaired_checkin"
  | "away_from_group"
  | "geofence"
  | "offline"
  | "untouched"
  | "late_night";

export interface RiskReason {
  code: RiskReasonCode;
  /** human readable, e.g. "fall detected 2 min ago" */
  text: string;
  weight: number;
}

export interface RiskAssessment {
  /** 0..100 */
  score: number;
  level: RiskLevel;
  /** sorted by weight, heaviest first */
  reasons: RiskReason[];
  /** e.g. "fall detected 2 min ago + missed a check-in + 310 m from your group"; "all good" when empty */
  summary: string;
}

/** 0 = monitoring, 1 = group alerted, 2 = bystander mode on the member's phone, 3 = emergency contact notified */
export type Stage = 0 | 1 | 2 | 3;

export type AppState = "foreground" | "background" | "locked";

export type SensorStatus = "on" | "off" | "denied" | "unavailable" | "unknown";

export type ShareLocation = "always" | "alert";

export interface Timers {
  /** periodic AI check-in cadence; 0 disables periodic check-ins */
  checkinEveryMs: number;
  /** how long the member has to answer a check-in before it counts as missed */
  checkinTimeoutMs: number;
  /** how long after impact the phone must stay still to confirm a fall (client side; advisory) */
  fallConfirmMs: number;
  /** how long a confirmed fall keeps counting towards risk */
  fallWindowMs: number;
  /** no significant movement for this long counts as prolonged stillness */
  stillnessMs: number;
  /** phone not touched for this long */
  untouchedMs: number;
  /** no heartbeat for this long while foregrounded => phone silent (dead-man's switch) */
  heartbeatLostMs: number;
  /** L1 (group) -> L2 (bystander) if nobody acknowledges */
  l1ToL2Ms: number;
  /** L2 (bystander) -> L3 (emergency contact) if nobody acknowledges */
  l2ToL3Ms: number;
  /** an "I'm on my way" pauses the ladder for this long */
  ackHoldMs: number;
  /** minimum gap between suspicion-triggered check-ins */
  probeCooldownMs: number;
}

// ---------------------------------------------------------------- check-ins

export type CheckinOutcome = "ok" | "impaired" | "missed";

export interface CheckinResult {
  engine: "gemini" | "openai" | "mock";
  /** e.g. "gemini-flash-lite-latest", or "demo script" */
  model?: string;
  transcript: string;
  /** did the member say anything intelligible at all */
  responded: boolean;
  coherent: boolean;
  /** 0 = sober and oriented, 1 = severely impaired */
  impairment: number;
  signs: string[];
  /** one short phrase a friend would understand, e.g. "slurred speech, couldn't say where they are" */
  reason: string;
  latencyMs: number;
  /** set when a better engine failed and we fell back */
  fallbackFrom?: string;
}

export interface Checkin {
  id: string;
  /** the question; the app should speak it aloud (TTS) and show it */
  prompt: string;
  /** why it was asked: "scheduled", "suspicion: fall", "alert", "manual", "requested by Sam", "demo" */
  trigger: string;
  askedAt: Millis;
  /** answer before this or it counts as missed */
  deadline: Millis;
  status: "pending" | "scoring" | "done";
  /** start recording automatically after speaking the prompt (false for automatic check-ins in demo mode) */
  autoListen: boolean;
  outcome?: CheckinOutcome;
  answeredAt?: Millis;
  /** present when status === "done" and it was answered. Transcript is blanked for other members outside an alert. */
  result?: CheckinResult;
}

// ---------------------------------------------------------------- alerts / escalation

export type AckKind = "on_my_way";

export interface Ack {
  /** member id of the guardian who acknowledged */
  by: string;
  byName: string;
  kind: AckKind;
  at: Millis;
}

/** The escalation state of one member. Present (non-null) only while that member's stage > 0. */
export interface AlertState {
  /** the member in trouble */
  memberId: string;
  memberName: string;
  stage: Stage;
  /** when the current stage was entered */
  stageSince: Millis;
  /** when the alert started (entered stage 1) */
  startedAt: Millis;
  /** when the ladder climbs next; null at stage 3 */
  nextEscalationAt: Millis | null;
  /** what raised it, e.g. the risk summary at the time, or "manual (Sam)" */
  trigger: string;
  acks: Ack[];
  /** stage >= 2: the affected member's phone shows bystander mode (siren, medical info, Call 911, PIN to cancel) */
  bystander: boolean;
  /** stage >= 3 */
  contactNotified: boolean;
}

export interface Notification {
  at: Millis;
  channel: "sms" | "voice" | "push";
  to: string;
  toName: string;
  /** member this notification is about */
  aboutMemberId: string;
  body: string;
  simulated: boolean;
  ok: boolean;
  detail: string;
}

export interface LogEvent {
  id: number;
  at: Millis;
  kind: "info" | "signal" | "checkin" | "alert" | "ok" | "notify" | "privacy";
  /** member the event is about, if any */
  memberId?: string;
  text: string;
}

// ---------------------------------------------------------------- member view model

export type Presence =
  /** WebSocket connected and heartbeating */
  | "online"
  /** app said it went to the background / screen locked; silence is expected, not alarming */
  | "background"
  /** no heartbeat for heartbeatLostMs while it should have been reporting */
  | "silent"
  /** has not connected yet, or left */
  | "offline";

export interface MemberSignals {
  lastHeartbeatAt: Millis | null;
  /** 0..1, null if unknown */
  battery: number | null;
  charging: boolean | null;
  appState: AppState;
  fallAt: Millis | null;
  lastMotionAt: Millis | null;
  lastInteractionAt: Millis | null;
  activity: MotionActivity | null;
  sensors: SensorReport;
}

export interface MemberView {
  id: string;
  name: string;
  /** stable UI colour for this member (hex), assigned by the server */
  color: string;
  /** true for the member this view was built for */
  isYou: boolean;
  /** demo-only simulated friend (moves + heartbeats on the server) */
  simulated: boolean;
  joinedAt: Millis;
  presence: Presence;
  lastSeenAt: Millis | null;
  /** null when hidden by privacy (shareLocation "alert" and no active alert) or unknown */
  fix: Fix | null;
  /** distance to the nearest other member with a fresh fix, beyond GPS uncertainty; null if unknown/hidden */
  distanceFromGroupM: number | null;
  nearestMemberId: string | null;
  /** distance to the centroid of the other members' fresh fixes (informational) */
  distanceFromCentroidM: number | null;
  risk: RiskAssessment;
  /** non-null while this member is in alert (stage >= 1) */
  alert: AlertState | null;
  /** pending check-in. Full detail for yourself; others see it too (prompt/status) so they know Wingman is asking. */
  checkin: Checkin | null;
  /** most recent finished check-in (others see outcome + reason; transcript only during an alert) */
  lastCheckin: Checkin | null;
  signals: MemberSignals;
  shareLocation: ShareLocation;
  /** Revealed to others only while this member is in alert; always to yourself. Empty string when hidden. */
  medical: string;
  emergencyContact: { name: string; /** masked ("•••••••99") for others outside an alert */ phone: string };
  /** yourself only: PIN entry is locked until this time after 3 wrong attempts */
  pinLockedUntil?: Millis;
  /** yourself only: whether the server has a push token for you */
  hasPushToken?: boolean;
}

export interface GroupLinks {
  /** https link: opens a page that deep-links into the app and shows the code, e.g. https://host/j/K7Q2XM */
  joinUrl: string;
  /** wingman://join/K7Q2XM */
  deepLink: string;
}

export interface GroupView {
  protocolVersion: number;
  code: string;
  name: string;
  /** server clock; use it for countdowns (nextEscalationAt - now) */
  now: Millis;
  status: "active" | "ended";
  demo: boolean;
  createdAt: Millis;
  /** member id of the viewer, null for the stage/observer view */
  you: string | null;
  /** you first, then join order */
  members: MemberView[];
  /** every member currently in alert, most severe first (same objects as members[i].alert) */
  alerts: AlertState[];
  timers: Timers;
  links: GroupLinks;
  /** newest last, capped */
  events: LogEvent[];
  /** L3 SMS/voice and push notifications sent (or simulated), newest last */
  notifications: Notification[];
  engines: { scorer: string; notifier: string; push: string };
}

// ---------------------------------------------------------------- REST: requests / responses

/** Everything a member provides when creating or joining a group. */
export interface MemberSetup {
  /** display name, 1-30 chars */
  name: string;
  /** 4-8 digits; cancels your own alert ("I'm OK") */
  pin: string;
  /** free text shown to bystanders/friends during an alert, max 600 chars */
  medical?: string;
  emergencyContact?: { name: string; phone: string };
  /** your own phone number (optional, lets friends call you from an alert) */
  phone?: string;
  /** "always" (default): friends see your location all night; "alert": only while you are in alert */
  shareLocation?: ShareLocation;
  /** must be true: the member agrees to be guarded tonight and to guard the others */
  consent: boolean;
  /** minutes, as from Date#getTimezoneOffset() on the device (for the late-night factor) */
  tzOffset?: number;
  /** optional, can also be sent later via the push-token endpoint */
  pushToken?: PushTokenRequest;
}

/** POST /api/groups */
export interface CreateGroupRequest {
  /** e.g. "Friday at the Rex"; defaults to "<name>'s night out" */
  groupName?: string;
  member: MemberSetup;
  /** accelerated timers + demo controls (stage use) */
  demo?: boolean;
}

/** Returned by both create and join. Store memberId + key securely (Keychain/SecureStore); they ARE the login. */
export interface JoinResponse {
  protocolVersion: number;
  code: string;
  memberId: string;
  /** per-member secret; send as `Authorization: Bearer <key>` and as `k=` on the WebSocket */
  key: string;
  links: GroupLinks;
  /** wss/ws path to connect to, relative: `/ws?g=CODE&m=MEMBER&k=KEY` */
  wsPath: string;
  view: GroupView;
}

export type CreateGroupResponse = JoinResponse;

/** POST /api/groups/:code/join */
export type JoinGroupRequest = MemberSetup;

/** GET /api/groups/:code (no auth): enough to render a "Join Maya's night out?" screen */
export interface GroupPreview {
  protocolVersion: number;
  code: string;
  name: string;
  status: "active" | "ended";
  demo: boolean;
  members: { name: string; color: string }[];
}

export type MotionActivity = "stationary" | "walking" | "running" | "automotive" | "cycling" | "unknown";

/**
 * POST /api/groups/:code/members/:id/signals (only for yourself), or WS {t:"signals", ...}.
 * Send every field you have; all optional. Recommended cadence: a heartbeat every 5 s in the foreground (with
 * battery/appState), fixes when they change by >10 m, motion summaries every 5-10 s, falls immediately.
 */
export interface SignalBatch {
  /** device clock at capture (informational only; the server timestamps on receipt) */
  at?: Millis;
  /** "I'm alive" (dead-man's switch). Any signal batch also counts as a heartbeat. */
  heartbeat?: boolean;
  /** 0..1 */
  battery?: number;
  charging?: boolean;
  /** send on every transition. "background"/"locked" BEFORE going quiet so silence isn't treated as alarming. */
  appState?: AppState;
  fix?: { lat: number; lng: number; accuracy: number; speed?: number | null; heading?: number | null };
  /** motion summary over the last window */
  motion?: {
    /** any significant movement in the window */
    moving: boolean;
    activity?: MotionActivity;
    steps?: number;
    /** peak acceleration magnitude in g over the window */
    peakG?: number;
    windowMs?: number;
  };
  /** confirmed fall: impact over ~2.6 g followed by stillness for fallConfirmMs. Send once per fall. */
  fall?: { peakG: number; at?: Millis };
  /** the user touched the app */
  interaction?: boolean;
  sensors?: Partial<SensorReport>;
}

export interface SensorReport {
  motion: SensorStatus;
  location: SensorStatus;
  mic: SensorStatus;
  notifications: SensorStatus;
}

export interface SignalResponse {
  ok: true;
  now: Millis;
}

/** POST /api/groups/:code/members/:id/checkins — ask a check-in now (yourself, or "ping" another member) */
export interface AskCheckinRequest {
  /** optional custom question */
  prompt?: string;
}
export interface AskCheckinResponse {
  ok: boolean;
  checkin: Checkin | null;
}

/**
 * POST /api/groups/:code/members/:id/checkins/:cid/answer (only for yourself). Either:
 *  - JSON {text} for a typed answer, or
 *  - JSON {audio: base64, mime} (iOS: "audio/m4a" AAC from expo-av/expo-audio HIGH_QUALITY preset; also accepted:
 *    audio/mp4, audio/x-m4a, audio/aac, audio/wav, audio/webm, audio/ogg, audio/mpeg), or
 *  - a raw binary body with Content-Type: audio/* (same formats).
 * Max 6 MB. The request returns after scoring (typically 1-4 s, at most ~25 s).
 */
export interface AnswerCheckinRequest {
  text?: string;
  /** base64 audio, no data: prefix */
  audio?: string;
  mime?: string;
  /** recording duration, informational */
  durationMs?: number;
}
export interface AnswerCheckinResponse {
  ok: boolean;
  checkin?: Checkin;
  error?: string;
}

/** POST /api/groups/:code/members/:id/ack — you (a guardian) acknowledge member :id's alert */
export interface AckRequest {
  kind?: AckKind;
}

/**
 * POST /api/groups/:code/members/:id/resolve
 *  - for yourself: requires your PIN ("I'm OK"); 3 wrong tries lock PIN entry for 30 s (HTTP 401 / 423)
 *  - for another member: "found & OK" (you are with them in person); no PIN
 */
export interface ResolveRequest {
  pin?: string;
  /** free-text note, e.g. "with her at the bar, she's fine" */
  note?: string;
}
export interface ResolveResponse {
  ok: boolean;
  /** set on a wrong PIN */
  lockedUntil?: Millis;
  attemptsLeft?: number;
  error?: string;
}

/** POST /api/groups/:code/members/:id/escalate — any member may push another member's alert up one level now */
export type EscalateRequest = Record<string, never>;

/** POST /api/groups/:code/members/:id/push-token (only for yourself). Optional; enables alerts while backgrounded. */
export interface PushTokenRequest {
  /** "expo": ExponentPushToken[...] from expo-notifications; "apns": raw device token hex */
  kind: "expo" | "apns";
  token: string;
  platform?: "ios" | "android";
}

/** POST /api/groups/:code/members/:id/settings (only for yourself) */
export interface MemberSettingsRequest {
  shareLocation?: ShareLocation;
  medical?: string;
  emergencyContact?: { name: string; phone: string };
}

/** POST /api/groups/:code/members/:id/leave (yourself) — your data is deleted; the group carries on */
/** POST /api/groups/:code/end (any member) — ends the night for everyone; all group data is deleted */
export interface OkResponse {
  ok: boolean;
  error?: string;
}

export interface ErrorResponse {
  error: string;
}

// ---------------------------------------------------------------- demo (stage) — not needed by the mobile app

export type DemoAction =
  | "walk"
  | "back"
  | "fall"
  | "slurred"
  | "coherent"
  | "miss"
  | "checkin"
  | "offline"
  | "online"
  | "escalate"
  | "ack"
  | "resolve"
  | "scene"
  | "reset";

/** POST /api/demo — create a demo group with simulated friends (Sam, Maya, Leo). Returns an observer (stage) key. */
export interface CreateDemoRequest {
  /** name for the presenter; the presenter's real phone joins with the join code like anyone else */
  presenterName?: string;
  /** which simulated friends to add (default ["Sam","Maya","Leo"]) */
  friends?: string[];
}
export interface CreateDemoResponse {
  code: string;
  /** read-all + demo-control key for the stage view: `/stage/CODE?k=KEY`, WS `/ws?g=CODE&k=KEY` (no m=) */
  stageKey: string;
  stageUrl: string;
  links: GroupLinks;
}

/** POST /api/groups/:code/demo/:action {target?: memberId, by?: memberId, ...} (stage key, or any member in a demo group) */
export interface DemoActionRequest {
  /** the member the action is about (default: the story subject) */
  target?: string;
  /** for "ack": who acknowledges (default: the first simulated friend) */
  by?: string;
  distM?: number;
  durationMs?: number;
  delayMs?: number;
  /** wait for scoring before responding */
  wait?: boolean;
}

// ---------------------------------------------------------------- WebSocket

/**
 * Connect: GET /ws?g=CODE&m=MEMBER_ID&k=KEY  (upgrade). Stage/observer: /ws?g=CODE&k=STAGE_KEY.
 * The server sends `hello` immediately, then `view` on every visible change (full snapshot, ~<=4/s), plus discrete
 * `alert` / `checkin` / `resolved` messages for side effects (local notification, haptics, TTS). The view is the
 * source of truth; discrete messages are hints. Reconnect with backoff; on reconnect you get a fresh hello.
 */
export type ServerMsg =
  | { t: "hello"; protocolVersion: number; you: string | null; view: GroupView }
  | { t: "view"; view: GroupView }
  /** a member's alert started (stage 1) or climbed. `you` = this alert is about YOU (stage 2: show bystander mode). */
  | { t: "alert"; alert: AlertState; you: boolean; title: string; body: string }
  /** someone acknowledged an alert ("Sam is on the way to Maya") */
  | { t: "ack"; alert: AlertState; ack: Ack; you: boolean }
  /** an alert ended */
  | { t: "resolved"; memberId: string; memberName: string; by: string; how: string; fromStage: Stage; you: boolean }
  /** the server asks YOU a check-in: speak `checkin.prompt`, then record and POST the answer */
  | { t: "checkin"; checkin: Checkin }
  /** a member joined or left */
  | { t: "member"; event: "joined" | "left"; memberId: string; name: string }
  /** the night ended (by a member, or after 12 h): delete local group state */
  | { t: "ended"; reason: string }
  /** you were removed (left the group from another device) */
  | { t: "left" }
  | { t: "error"; error: string }
  | { t: "pong"; now: Millis };

export type ClientMsg =
  /** keep-alive; also counts as a heartbeat */
  | { t: "ping" }
  /** same payload as POST .../signals, for yourself */
  | ({ t: "signals" } & SignalBatch);

// ---------------------------------------------------------------- helpers (pure)

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, JOIN_CODE_LENGTH);
}

export function isJoinCode(s: string): boolean {
  return s.length === JOIN_CODE_LENGTH && [...s].every((c) => JOIN_CODE_ALPHABET.includes(c));
}

/** Extract a join code from a scanned/pasted link ("wingman://join/K7Q2XM", "https://host/j/K7Q2XM") or a bare code. */
export function parseJoinLink(text: string): string | null {
  const m = text.trim().match(/(?:join\/|\/j\/)([A-Za-z0-9]{6})\b/) ?? text.trim().match(/^([A-Za-z0-9]{6})$/);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  return isJoinCode(code) ? code : null;
}
