// Pure, deterministic risk engine: signals in, risk level + human-readable reasons out.
// No clocks, no I/O; `now` is passed in so tests (and the demo) are reproducible.

import { AWAY_FAR_M, AWAY_WATCH_M } from "../shared/config.ts";
import { fmtAgo, fmtDistance, fmtDuration } from "../shared/geo.ts";
import type { CheckinOutcome, RiskAssessment, RiskLevel, RiskReason, Timers } from "../shared/types.ts";

export interface RiskInput {
  now: number;
  timers: Timers;
  sessionStartedAt: number;
  /** Signals at or before this instant were cleared by a coherent check-in, a PIN "I'm OK", or a buddy. */
  clearedAt: number;
  fallAt: number | null;
  lastMotionAt: number | null;
  lastInteractionAt: number | null;
  lastHeartbeatAt: number | null;
  /** distance from the group beyond GPS uncertainty, null if unknown */
  awayM: number | null;
  /** when the person first drifted beyond AWAY_WATCH_M (null if not away) */
  awaySince: number | null;
  /** what "the group" is: buddies' live positions, or the venue where the night started */
  awayFrom: "group" | "venue";
  outsideGeofence: boolean;
  geofenceSince: number | null;
  checkins: { at: number; outcome: CheckinOutcome; impairment: number; reason: string }[];
  /** local hour of day at the person's location (0-23) */
  localHour: number;
}

export const WATCH_AT = 25;
export const ALERT_AT = 60;

export const WEIGHTS = {
  fall: 35,
  stillness: 15,
  missedOne: 35,
  missedMany: 60,
  impairedMin: 20,
  impairedMax: 60,
  impairedRepeat: 10,
  awayNear: 12,
  awayFar: 25,
  geofence: 10,
  offline: 30,
  untouched: 10,
  lateNight: 10,
} as const;

export function levelFor(score: number): RiskLevel {
  if (score >= ALERT_AT) return "alert";
  if (score >= WATCH_AT) return "watch";
  return "ok";
}

export function assessRisk(i: RiskInput): RiskAssessment {
  const reasons: RiskReason[] = [];
  const { now, timers: t } = i;
  const fresh = (at: number | null) => at !== null && at > i.clearedAt;

  // Impact followed by stillness (confirmed on the phone).
  if (fresh(i.fallAt) && now - i.fallAt! <= t.fallWindowMs) {
    reasons.push({ code: "fall", text: `fall detected ${fmtAgo(now - i.fallAt!)}`, weight: WEIGHTS.fall });
  }

  // Check-ins answered since the last "all clear".
  const recent = i.checkins.filter((c) => c.at > i.clearedAt);
  const missed = recent.filter((c) => c.outcome === "missed");
  if (missed.length === 1) {
    reasons.push({ code: "missed_checkin", text: "missed a check-in", weight: WEIGHTS.missedOne });
  } else if (missed.length >= 2) {
    reasons.push({ code: "missed_checkin", text: `missed ${missed.length} check-ins in a row`, weight: WEIGHTS.missedMany });
  }
  const impaired = recent.filter((c) => c.outcome === "impaired");
  if (impaired.length > 0) {
    const worst = impaired.reduce((a, b) => (b.impairment > a.impairment ? b : a));
    const span = WEIGHTS.impairedMax - WEIGHTS.impairedMin;
    let w = Math.round(WEIGHTS.impairedMin + span * clamp((worst.impairment - 0.5) / 0.5, 0, 1));
    if (impaired.length > 1) w += WEIGHTS.impairedRepeat;
    const why = worst.reason ? `: ${worst.reason}` : "";
    reasons.push({ code: "impaired_checkin", text: `check-in answer sounded impaired${why}`, weight: w });
  }

  // Drifting away from the group (only drifts that started after the last all-clear count).
  if (i.awayM !== null && i.awayM >= AWAY_WATCH_M && fresh(i.awaySince ?? now)) {
    const w = i.awayM >= AWAY_FAR_M ? WEIGHTS.awayFar : WEIGHTS.awayNear;
    const from = i.awayFrom === "group" ? "your group" : "where the night started";
    reasons.push({ code: "away_from_group", text: `${fmtDistance(i.awayM)} from ${from}`, weight: w });
  }
  if (i.outsideGeofence && fresh(i.geofenceSince ?? now)) {
    reasons.push({ code: "geofence", text: "left the venue area", weight: WEIGHTS.geofence });
  }

  // Dead-man's switch: the phone stopped reporting. Cannot be cleared by an old check-in.
  if (i.lastHeartbeatAt !== null && now - i.lastHeartbeatAt >= t.heartbeatLostMs) {
    reasons.push({ code: "offline", text: `phone went silent ${fmtAgo(now - i.lastHeartbeatAt)}`, weight: WEIGHTS.offline });
  }

  const base = Math.max(i.sessionStartedAt, i.clearedAt);
  const still = now - Math.max(i.lastMotionAt ?? base, base);
  if (still >= t.stillnessMs) {
    reasons.push({ code: "stillness", text: `no movement for ${fmtDuration(still)}`, weight: WEIGHTS.stillness });
  }
  const untouched = now - Math.max(i.lastInteractionAt ?? base, base);
  if (untouched >= t.untouchedMs) {
    reasons.push({ code: "untouched", text: `phone untouched for ${fmtDuration(untouched)}`, weight: WEIGHTS.untouched });
  }

  if (reasons.length > 0 && i.localHour >= 1 && i.localHour < 6) {
    const h = i.localHour;
    reasons.push({ code: "late_night", text: `it's ${h} AM`, weight: WEIGHTS.lateNight });
  }

  reasons.sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, reasons.reduce((s, r) => s + r.weight, 0));
  return {
    score,
    level: levelFor(score),
    reasons,
    summary: reasons.length ? reasons.map((r) => r.text).join(" + ") : "all good",
  };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
