// App state as a pure reducer (unit-tested in tests/reducer.test.ts). Side effects live in src/services.

import type { AlertState, Checkin, GroupView, MemberView, ServerMsg } from "@shared/protocol";

export interface Profile {
  name: string;
  phone: string;
  medical: string;
  contactName: string;
  contactPhone: string;
}

export interface Membership {
  code: string;
  memberId: string;
  key: string;
  /** server this membership belongs to */
  serverUrl: string;
}

export type Connection = "idle" | "connecting" | "open" | "closed";

export interface State {
  hydrated: boolean;
  onboarded: boolean;
  profile: Profile;
  serverUrl: string;
  membership: Membership | null;
  view: GroupView | null;
  /** serverNow - deviceNow, so countdowns use the server clock */
  clockOffset: number;
  connection: Connection;
  /** alert takeovers the user has handled, keyed by `${memberId}:${startedAt}` */
  handledAlerts: Record<string, true>;
  /** check-ins this phone has already answered or dismissed locally */
  handledCheckins: Record<string, true>;
  /** the check-in on screen; kept while it's being scored even after the server stops listing it as pending */
  activeCheckin: Checkin | null;
  /** last outcome to show on the check-in sheet */
  lastAnswered: Checkin | null;
  /** why the last night ended, shown once on the start screen */
  endedReason: string | null;
}

export const emptyProfile: Profile = { name: "", phone: "", medical: "", contactName: "", contactPhone: "" };

export const initialState: State = {
  hydrated: false,
  onboarded: false,
  profile: emptyProfile,
  serverUrl: "",
  membership: null,
  view: null,
  clockOffset: 0,
  connection: "idle",
  handledAlerts: {},
  handledCheckins: {},
  activeCheckin: null,
  lastAnswered: null,
  endedReason: null,
};

export type Action =
  | { type: "hydrate"; profile: Profile | null; membership: Membership | null; serverUrl: string; onboarded: boolean }
  | { type: "profile"; profile: Profile }
  | { type: "onboarded" }
  | { type: "serverUrl"; url: string }
  | { type: "joined"; membership: Membership; view: GroupView; at: number }
  | { type: "server"; msg: ServerMsg; at: number }
  | { type: "connection"; status: Connection }
  | { type: "handleAlert"; alert: Pick<AlertState, "memberId" | "startedAt"> }
  | { type: "handleCheckin"; id: string }
  | { type: "answered"; checkin: Checkin }
  | { type: "clearAnswered" }
  | { type: "left"; reason: string | null };

export const alertKey = (a: Pick<AlertState, "memberId" | "startedAt">) => `${a.memberId}:${a.startedAt}`;

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "hydrate":
      return {
        ...s,
        hydrated: true,
        profile: a.profile ?? emptyProfile,
        membership: a.membership,
        serverUrl: a.serverUrl,
        onboarded: a.onboarded,
      };
    case "profile":
      return { ...s, profile: a.profile };
    case "onboarded":
      return { ...s, onboarded: true };
    case "serverUrl":
      return { ...s, serverUrl: a.url };
    case "joined":
      return {
        ...s,
        membership: a.membership,
        view: a.view,
        clockOffset: a.view.now - a.at,
        handledAlerts: {},
        handledCheckins: {},
        activeCheckin: null,
        lastAnswered: null,
        endedReason: null,
      };
    case "connection":
      return { ...s, connection: a.status };
    case "handleAlert":
      return { ...s, handledAlerts: { ...s.handledAlerts, [alertKey(a.alert)]: true } };
    case "handleCheckin":
      return { ...s, activeCheckin: s.activeCheckin?.id === a.id ? null : s.activeCheckin, handledCheckins: { ...s.handledCheckins, [a.id]: true } };
    case "answered":
      return {
        ...s,
        lastAnswered: a.checkin,
        activeCheckin: s.activeCheckin?.id === a.checkin.id ? null : s.activeCheckin,
        handledCheckins: { ...s.handledCheckins, [a.checkin.id]: true },
      };
    case "clearAnswered":
      return { ...s, lastAnswered: null };
    case "left":
      return { ...s, membership: null, view: null, connection: "idle", handledAlerts: {}, handledCheckins: {}, activeCheckin: null, lastAnswered: null, endedReason: a.reason };
    case "server":
      return onServer(s, a.msg, a.at);
  }
}

function onServer(s: State, m: ServerMsg, at: number): State {
  switch (m.t) {
    case "hello":
    case "view": {
      if (m.view.status === "ended") return reducer(s, { type: "left", reason: "The night has ended. Everyone's data was deleted." });
      // An alert that resolved and came back is a new episode, so prune handled keys that no longer exist.
      const live = new Set(m.view.alerts.map(alertKey));
      const handledAlerts = Object.fromEntries(Object.keys(s.handledAlerts).filter((k) => live.has(k)).map((k) => [k, true as const]));
      return { ...s, view: m.view, clockOffset: m.view.now - at, handledAlerts, activeCheckin: nextActiveCheckin(s, m.view) };
    }
    case "ended":
      return reducer(s, { type: "left", reason: m.reason ? `The night has ended (${m.reason}). Everyone's data was deleted.` : null });
    case "left":
      return reducer(s, { type: "left", reason: null });
    default:
      return s;
  }
}

/** Keep the on-screen check-in stable: adopt a new pending one, drop it if it was missed (deadline passed). */
function nextActiveCheckin(s: State, v: GroupView): Checkin | null {
  const self = v.members.find((m) => m.isYou);
  const pending = self?.checkin && self.checkin.status === "pending" && !s.handledCheckins[self.checkin.id] ? self.checkin : null;
  const cur = s.activeCheckin;
  if (!cur) return pending;
  const last = self?.lastCheckin;
  if (last?.id === cur.id && last.outcome === "missed" && !last.answeredAt) return pending;
  if (pending && pending.id !== cur.id && self?.checkin?.id !== cur.id) return pending;
  return self?.checkin?.id === cur.id ? self.checkin : cur;
}

// ---------------------------------------------------------------- selectors

export const me = (s: State): MemberView | null => s.view?.members.find((m) => m.isYou) ?? null;
export const others = (s: State): MemberView[] => s.view?.members.filter((m) => !m.isYou) ?? [];

/** Card order: anyone in alert first (most severe), then you, then the rest in join order. */
export function orderedMembers(v: GroupView | null): MemberView[] {
  if (!v) return [];
  const rank = (m: MemberView) => (m.alert ? -10 + -m.alert.stage : m.isYou ? 0 : 1);
  return v.members.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
}

export type Overlay =
  | { kind: "bystander"; alert: AlertState }
  | { kind: "alert"; alert: AlertState; member: MemberView }
  | { kind: "checkin"; checkin: Checkin }
  | null;

/** What takes over the screen right now. Bystander mode beats a friend's alert, which beats a check-in. */
export function overlay(s: State): Overlay {
  const self = me(s);
  if (!s.view || !self) return null;
  if (self.alert && self.alert.stage >= 2) return { kind: "bystander", alert: self.alert };
  for (const a of s.view.alerts) {
    if (a.memberId === self.id || s.handledAlerts[alertKey(a)]) continue;
    if (a.acks.some((k) => k.by === self.id)) continue;
    const member = s.view.members.find((m) => m.id === a.memberId);
    if (member) return { kind: "alert", alert: a, member };
  }
  const c = s.activeCheckin;
  if (c && !s.handledCheckins[c.id]) return { kind: "checkin", checkin: c };
  return null;
}

export type Tone = "ok" | "watch" | "alert" | "quiet";

/** One dot colour + one short line per member card. */
export function memberStatus(m: MemberView, now: number, youId?: string | null): { tone: Tone; label: string } {
  if (m.alert) {
    const acks = m.alert.acks;
    const mine = acks.some((a) => a.by === youId);
    const by = acks[acks.length - 1];
    const label = mine ? "You're on your way" : by ? `${by.byName} is on the way` : m.alert.stage >= 3 ? "Emergency contact notified" : m.alert.stage >= 2 ? "Siren on their phone" : "May need help";
    return { tone: "alert", label };
  }
  if (m.checkin && m.checkin.status !== "done") return { tone: "watch", label: "Checking in…" };
  if (m.presence === "silent") return { tone: "watch", label: `Phone went quiet · ${ago(m.lastSeenAt, now)}` };
  if (m.presence === "offline") return { tone: "quiet", label: m.lastSeenAt ? `Offline · ${ago(m.lastSeenAt, now)}` : "Hasn't opened Wingman yet" };
  if (m.risk.level === "watch") return { tone: "watch", label: shortReason(m) };
  return { tone: "ok", label: `OK · ${ago(m.lastSeenAt, now)}` };
}

function shortReason(m: MemberView): string {
  const r = m.risk.reasons[0];
  if (!r) return "Keeping an eye on it";
  return capitalize(r.text);
}

export function capitalize(s: string) {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function ago(t: number | null | undefined, now: number): string {
  if (!t) return "never";
  const d = Math.max(0, now - t);
  if (d < 45_000) return "just now";
  const min = Math.round(d / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ago`;
}

/** Plain reasons for a takeover, at most three. */
export function alertReasons(m: MemberView): string[] {
  const out = m.risk.reasons.slice(0, 3).map((r) => capitalize(r.text));
  if (!out.length && m.alert) out.push(capitalize(m.alert.trigger));
  return out;
}

export function distanceM(a: { lat: number; lng: number } | null | undefined, b: { lat: number; lng: number } | null | undefined): number | null {
  if (!a || !b) return null;
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number | null): string {
  if (m === null) return "";
  if (m < 30) return "Right here";
  if (m < 1000) return `${Math.round(m / 10) * 10} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}
