import { expect, test } from "bun:test";
import type { AlertState, GroupView, MemberView } from "@shared/protocol";
import { alertKey, initialState, memberStatus, overlay, reducer, type State } from "../src/state/reducer";

const NOW = 1_800_000_000_000;

function member(id: string, name: string, p: Partial<MemberView> = {}): MemberView {
  return {
    id, name, color: "#fff", isYou: false, simulated: false, joinedAt: NOW, presence: "online", lastSeenAt: NOW - 1000, fix: null,
    distanceFromGroupM: null, nearestMemberId: null, distanceFromCentroidM: null,
    risk: { score: 0, level: "ok", reasons: [], summary: "all good" }, alert: null, checkin: null, lastCheckin: null,
    signals: { lastHeartbeatAt: NOW, battery: 1, charging: false, appState: "foreground", fallAt: null, lastMotionAt: null, lastInteractionAt: null, activity: null,
      sensors: { motion: "on", location: "on", mic: "on", notifications: "on" } },
    shareLocation: "always", phone: "", medical: "", emergencyContact: { name: "", phone: "" }, ...p,
  };
}

function alert(memberId: string, stage: 1 | 2 | 3, p: Partial<AlertState> = {}): AlertState {
  return { memberId, memberName: memberId, stage, stageSince: NOW, startedAt: NOW - 5000, nextEscalationAt: NOW + 60_000, trigger: "fall", acks: [], bystander: stage >= 2, contactNotified: stage >= 3, ...p };
}

function view(members: MemberView[], p: Partial<GroupView> = {}): GroupView {
  return {
    protocolVersion: 2, code: "K7Q2XM", name: "n", now: NOW, status: "active", demo: false, createdAt: NOW, you: "me", members,
    alerts: members.flatMap((m) => (m.alert ? [m.alert] : [])), timers: {} as any,
    links: { joinUrl: "", deepLink: "" }, events: [], notifications: [], engines: { scorer: "", notifier: "", push: "" }, ...p,
  };
}

const joined = (v: GroupView): State =>
  reducer({ ...initialState, hydrated: true }, { type: "joined", membership: { code: "K7Q2XM", memberId: "me", key: "k", serverUrl: "x" }, view: v, at: NOW - 2000 });

test("clock offset follows the server clock", () => {
  expect(joined(view([member("me", "Me", { isYou: true })])).clockOffset).toBe(2000);
});

test("a friend's alert takes over the screen until handled", () => {
  const maya = member("maya", "Maya", { alert: alert("maya", 1) });
  let s = joined(view([member("me", "Me", { isYou: true }), maya]));
  expect(overlay(s)).toMatchObject({ kind: "alert", member: { id: "maya" } });
  s = reducer(s, { type: "handleAlert", alert: maya.alert! });
  expect(overlay(s)).toBeNull();
});

test("acking an alert removes the takeover; a new episode brings it back", () => {
  const acked = alert("maya", 1, { acks: [{ by: "me", byName: "Me", kind: "on_my_way", at: NOW }] });
  let s = joined(view([member("me", "Me", { isYou: true }), member("maya", "Maya", { alert: acked })]));
  expect(overlay(s)).toBeNull();
  s = reducer(s, { type: "handleAlert", alert: acked });
  const again = alert("maya", 1, { startedAt: NOW + 100_000 });
  s = reducer(s, { type: "server", msg: { t: "view", view: view([member("me", "Me", { isYou: true }), member("maya", "Maya", { alert: again })]) }, at: NOW });
  expect(overlay(s)).toMatchObject({ kind: "alert" });
  expect(s.handledAlerts[alertKey(acked)]).toBeUndefined();
});

test("bystander mode beats everything else", () => {
  const s = joined(view([member("me", "Me", { isYou: true, alert: alert("me", 2) }), member("maya", "Maya", { alert: alert("maya", 1) })]));
  expect(overlay(s)?.kind).toBe("bystander");
});

test("own stage-1 alert does not show bystander mode", () => {
  const s = joined(view([member("me", "Me", { isYou: true, alert: alert("me", 1) })]));
  expect(overlay(s)).toBeNull();
});

test("a check-in stays on screen while it is scored, then closes when answered", () => {
  const c = { id: "c1", prompt: "Where are you?", trigger: "manual", askedAt: NOW, deadline: NOW + 60_000, status: "pending" as const, autoListen: true };
  let s = joined(view([member("me", "Me", { isYou: true })]));
  s = reducer(s, { type: "server", msg: { t: "view", view: view([member("me", "Me", { isYou: true, checkin: c })]) }, at: NOW });
  expect(overlay(s)).toMatchObject({ kind: "checkin", checkin: { id: "c1" } });
  // the server finishes scoring before our HTTP response arrives
  const done = { ...c, status: "done" as const, outcome: "ok" as const, answeredAt: NOW };
  s = reducer(s, { type: "server", msg: { t: "view", view: view([member("me", "Me", { isYou: true, lastCheckin: done })]) }, at: NOW });
  expect(overlay(s)).toMatchObject({ kind: "checkin" });
  s = reducer(s, { type: "answered", checkin: done });
  expect(overlay(s)).toBeNull();
});

test("a missed check-in closes the sheet", () => {
  const c = { id: "c1", prompt: "?", trigger: "manual", askedAt: NOW, deadline: NOW + 1, status: "pending" as const, autoListen: true };
  let s = joined(view([member("me", "Me", { isYou: true, checkin: c })]));
  s = reducer(s, { type: "server", msg: { t: "view", view: view([member("me", "Me", { isYou: true, checkin: c })]) }, at: NOW });
  expect(overlay(s)?.kind).toBe("checkin");
  s = reducer(s, { type: "server", msg: { t: "view", view: view([member("me", "Me", { isYou: true, lastCheckin: { ...c, status: "done", outcome: "missed" } })]) }, at: NOW });
  expect(overlay(s)).toBeNull();
});

test("ended night clears the group and explains why", () => {
  let s = joined(view([member("me", "Me", { isYou: true })]));
  s = reducer(s, { type: "server", msg: { t: "ended", reason: "ended by Sam" }, at: NOW });
  expect(s.membership).toBeNull();
  expect(s.endedReason).toContain("ended by Sam");
});

test("member status lines", () => {
  expect(memberStatus(member("a", "A"), NOW)).toEqual({ tone: "ok", label: "OK · just now" });
  expect(memberStatus(member("a", "A", { lastSeenAt: NOW - 2 * 60_000 }), NOW).label).toBe("OK · 2 min ago");
  expect(memberStatus(member("a", "A", { presence: "silent", lastSeenAt: NOW - 3 * 60_000 }), NOW)).toEqual({ tone: "watch", label: "Phone went quiet · 3 min ago" });
  expect(memberStatus(member("a", "A", { alert: alert("a", 1, { acks: [{ by: "s", byName: "Sam", kind: "on_my_way", at: NOW }] }) }), NOW).label).toBe("Sam is on the way");
});
