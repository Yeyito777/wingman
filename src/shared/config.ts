import type { Timers } from "./types.ts";

const S = 1000;
const MIN = 60 * S;

/** Realistic timers for an actual night out. */
export const REAL_TIMERS: Timers = {
  checkinEveryMs: 30 * MIN,
  checkinTimeoutMs: 60 * S,
  fallConfirmMs: 10 * S,
  fallWindowMs: 15 * MIN,
  stillnessMs: 20 * MIN,
  untouchedMs: 45 * MIN,
  heartbeatLostMs: 2 * MIN,
  l1ToL2Ms: 3 * MIN,
  l2ToL3Ms: 4 * MIN,
  ackHoldMs: 10 * MIN,
  probeCooldownMs: 3 * MIN,
};

/** Accelerated timers so the whole ladder plays out inside a 4-minute pitch. */
export const DEMO_TIMERS: Timers = {
  checkinEveryMs: 0, // periodic check-ins off on stage; the presenter triggers them
  checkinTimeoutMs: 90 * S, // long enough that narration between storyline steps never turns into a "missed" check-in
  fallConfirmMs: 3 * S,
  fallWindowMs: 10 * MIN,
  stillnessMs: 10 * MIN,
  untouchedMs: 30 * MIN,
  heartbeatLostMs: 60 * S,
  l1ToL2Ms: 15 * S,
  l2ToL3Ms: 15 * S,
  ackHoldMs: 60 * S,
  probeCooldownMs: 20 * S,
};

/** Distance thresholds (metres) beyond position uncertainty. */
export const AWAY_WATCH_M = 150;
export const AWAY_FAR_M = 300;
export const DEFAULT_GEOFENCE_M = 400;

/** UTSC, Toronto: used as a venue when no GPS fix is available (e.g. demo laptop). */
export const DEFAULT_VENUE = { lat: 43.78446, lng: -79.18747 };

export const CHECKIN_PROMPTS = [
  "Hey, it's Wingman. Quick check-in: where are you right now, and who are you with?",
  "Check-in time. Tell me the name of the place you're at, and how you're getting home.",
  "Hey, quick one: who are you with right now, and what are you up to?",
];

export const PROBE_PROMPTS: Record<string, string> = {
  fall: "Hey, that looked like a hard fall. Are you okay? Tell me where you are and who's with you.",
  away_from_group: "Hey, looks like you've drifted away from your group. Where are you headed, and who are you with?",
  stillness: "You've been really still for a while. Are you okay? Tell me where you are.",
  impaired_checkin: "Let's try that again. Tell me slowly: where are you, and who's with you right now?",
  missed_checkin: "Hey, I didn't hear you. Are you okay? Just tell me where you are.",
  offline: "You went quiet for a bit. Are you okay? Tell me where you are.",
  alert: "Your buddies have been alerted. If you're okay, tell me where you are and who you're with.",
  default: "Hey, just checking on you. Where are you right now, and who are you with?",
};
