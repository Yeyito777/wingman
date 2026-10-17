// Types shared by the server and the browser clients.

export type Role = "user" | "buddy" | "demo";

export interface Fix {
  lat: number;
  lng: number;
  /** metres (1-sigma radius reported by the browser) */
  accuracy: number;
  at: number;
}

export type RiskLevel = "ok" | "watch" | "alert";

export interface RiskReason {
  code:
    | "fall"
    | "stillness"
    | "missed_checkin"
    | "impaired_checkin"
    | "away_from_group"
    | "geofence"
    | "offline"
    | "untouched"
    | "late_night";
  text: string;
  weight: number;
}

export interface RiskAssessment {
  score: number; // 0..100
  level: RiskLevel;
  reasons: RiskReason[];
  /** e.g. "fall detected 2 min ago + missed check-in + 300 m from your group" */
  summary: string;
}

/** 0 = monitoring, 1 = buddies alerted, 2 = bystander mode, 3 = emergency contact notified */
export type Stage = 0 | 1 | 2 | 3;

export interface Timers {
  /** periodic AI check-in cadence; 0 disables periodic check-ins */
  checkinEveryMs: number;
  /** how long the person has to answer a check-in before it counts as missed */
  checkinTimeoutMs: number;
  /** how long after impact the phone must stay still to confirm a fall (client side) */
  fallConfirmMs: number;
  /** how long a confirmed fall keeps counting towards risk */
  fallWindowMs: number;
  /** no significant movement for this long counts as prolonged stillness */
  stillnessMs: number;
  /** phone not touched for this long */
  untouchedMs: number;
  /** no heartbeat for this long => phone offline / dead / locked */
  heartbeatLostMs: number;
  /** L1 (buddies) -> L2 (bystander) if nobody acknowledges */
  l1ToL2Ms: number;
  /** L2 (bystander) -> L3 (emergency contact) if nobody acknowledges */
  l2ToL3Ms: number;
  /** a buddy acknowledgement pauses the ladder for this long */
  ackHoldMs: number;
  /** minimum gap between suspicion-triggered check-ins */
  probeCooldownMs: number;
}

export interface CheckinResult {
  engine: "gemini" | "openai" | "mock";
  model?: string;
  transcript: string;
  /** did the person say anything intelligible at all */
  responded: boolean;
  coherent: boolean;
  /** 0 = sober and oriented, 1 = severely impaired */
  impairment: number;
  signs: string[];
  reason: string;
  latencyMs: number;
  /** set when a better engine failed and we fell back */
  fallbackFrom?: string;
}

export type CheckinOutcome = "ok" | "impaired" | "missed";

export interface Checkin {
  id: string;
  prompt: string;
  /** why it was asked: "scheduled", "suspicion: fall", "alert", "manual" */
  trigger: string;
  askedAt: number;
  deadline: number;
  status: "pending" | "scoring" | "done";
  outcome?: CheckinOutcome;
  answeredAt?: number;
  result?: CheckinResult;
}

export interface LogEvent {
  id: number;
  at: number;
  kind: "info" | "signal" | "checkin" | "alert" | "ok" | "notify" | "privacy";
  text: string;
}

export interface Notification {
  at: number;
  channel: "sms" | "voice";
  to: string;
  toName: string;
  body: string;
  simulated: boolean;
  ok: boolean;
  detail: string;
}

export interface BuddyView {
  id: string;
  name: string;
  online: boolean;
  joinedAt: number;
  fix: Fix | null;
}

export interface SessionView {
  id: string;
  now: number;
  role: Role;
  status: "active" | "ended";
  demo: boolean;
  startedAt: number;
  user: {
    name: string;
    phone: string;
    medical: string;
    contactName: string;
    contactPhone: string;
    shareLocation: "always" | "alert";
  };
  timers: Timers;
  risk: RiskAssessment;
  stage: Stage;
  stageSince: number;
  nextEscalationAt: number | null;
  acks: { name: string; at: number }[];
  /** null when hidden from this viewer (privacy) or unknown */
  fix: Fix | null;
  venue: Fix | null;
  geofenceM: number;
  distanceFromGroupM: number | null;
  buddies: BuddyView[];
  checkin: Checkin | null;
  checkins: Checkin[];
  signals: {
    fallAt: number | null;
    lastMotionAt: number | null;
    lastInteractionAt: number | null;
    lastHeartbeatAt: number | null;
    battery: number | null;
    sensors: { motion: string; location: string; mic: string };
    offlineSimulated: boolean;
    backgrounded: boolean;
    walking: boolean;
  };
  events: LogEvent[];
  notifications: Notification[];
  engines: { scorer: string; notifier: string };
  inviteUrl?: string;
  pinLockedUntil?: number;
  demoAnswerMode?: "canned" | "live";
}

export type ServerMsg = { t: "view"; view: SessionView } | { t: "ended" } | { t: "error"; error: string };
