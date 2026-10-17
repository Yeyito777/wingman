// An in-process fake server speaking the real protocol, injected into WingmanClient as fetch + WebSocket.
// Used for screenshots (web), offline UI work, and a "try it without a server" mode (server URL "mock").

import type { AlertState, Checkin, GroupView, JoinResponse, MemberView, ServerMsg } from "@shared/protocol";
import { PROTOCOL_VERSION } from "@shared/protocol";
import type { ClientDeps, WebSocketLike } from "./client";

const BASE = { lat: 43.64872, lng: -79.39616 }; // King West, Toronto
const MIN = 60_000;

export type MockScene = "calm" | "friend-alert" | "friend-acked" | "bystander" | "checkin" | "watch";

interface World {
  code: string;
  youId: string;
  scene: MockScene;
  members: MemberView[];
  createdAt: number;
  sockets: Set<FakeSocket>;
  ended: boolean;
}

let world: World | null = null;

function member(p: Partial<MemberView> & { id: string; name: string; color: string }, now: number): MemberView {
  return {
    isYou: false,
    simulated: true,
    joinedAt: now - 40 * MIN,
    presence: "online",
    lastSeenAt: now - 20_000,
    fix: null,
    distanceFromGroupM: null,
    nearestMemberId: null,
    distanceFromCentroidM: null,
    risk: { score: 4, level: "ok", reasons: [], summary: "all good" },
    alert: null,
    checkin: null,
    lastCheckin: null,
    signals: {
      lastHeartbeatAt: now - 5000,
      battery: 0.7,
      charging: false,
      appState: "foreground",
      fallAt: null,
      lastMotionAt: now - 30_000,
      lastInteractionAt: now - 60_000,
      activity: "stationary",
      sensors: { motion: "on", location: "on", mic: "on", notifications: "on" },
    },
    shareLocation: "always",
    medical: "",
    emergencyContact: { name: "Mom", phone: "•••••••99" },
    ...p,
    phone: p.phone ?? "+1 416 555 0142",
  };
}

const at = (dLat: number, dLng: number, now: number) => ({ lat: BASE.lat + dLat, lng: BASE.lng + dLng, accuracy: 12, at: now });

function build(name: string, now: number): World {
  const youId = "m_you";
  const members = [
    member({ id: youId, name, color: "#6E8BFF", isYou: true, simulated: false, fix: at(0, 0, now), medical: "", emergencyContact: { name: "", phone: "" } }, now),
    member({ id: "m_maya", name: "Maya", color: "#FF6B9A", fix: at(0.0021, 0.0018, now), lastSeenAt: now - 2 * MIN }, now),
    member({ id: "m_sam", name: "Sam", color: "#30D5C8", fix: at(-0.0001, 0.0002, now), lastSeenAt: now - 30_000, signals: undefined as any }, now),
    member({ id: "m_leo", name: "Leo", color: "#FFB340", fix: at(0.0003, -0.0004, now), lastSeenAt: now - 4 * MIN, presence: "background" }, now),
  ];
  members[2]!.signals = members[1]!.signals;
  return { code: "K7Q2XM", youId, scene: "calm", members, createdAt: now - 52 * MIN, sockets: new Set(), ended: false };
}

function applyScene(w: World, scene: MockScene, now: number) {
  w.scene = scene;
  const maya = w.members.find((m) => m.id === "m_maya")!;
  const you = w.members.find((m) => m.isYou)!;
  for (const m of w.members) {
    m.alert = null;
    m.checkin = null;
    m.risk = { score: 4, level: "ok", reasons: [], summary: "all good" };
    if (!m.isYou) m.medical = "";
  }
  maya.fix = at(0.0021, 0.0018, now);
  if (scene === "watch") {
    maya.risk = { score: 34, level: "watch", reasons: [{ code: "away_from_group", text: "290 m from the group", weight: 12 }], summary: "290 m from the group" };
  }
  if (scene === "friend-alert" || scene === "friend-acked") {
    maya.fix = at(0.0026, 0.0024, now);
    maya.medical = "Allergic to penicillin. Asthma, inhaler in her bag.";
    maya.emergencyContact = { name: "Mom", phone: "+1 416 555 0199" };
    maya.risk = {
      score: 82,
      level: "alert",
      reasons: [
        { code: "impaired_checkin", text: "slurred speech, couldn't say where she is", weight: 45 },
        { code: "fall", text: "fell 2 min ago", weight: 30 },
        { code: "away_from_group", text: "350 m from the group", weight: 25 },
      ],
      summary: "slurred speech + fall + 350 m from the group",
    };
    maya.alert = alertFor(maya, 1, now, scene === "friend-acked" ? [{ by: w.youId, byName: you.name, kind: "on_my_way", at: now - 20_000 }] : []);
  }
  if (scene === "bystander") {
    you.risk = {
      score: 88,
      level: "alert",
      reasons: [
        { code: "missed_checkin", text: "didn't answer two check-ins", weight: 60 },
        { code: "fall", text: "fell 3 min ago", weight: 30 },
      ],
      summary: "missed check-ins + fall",
    };
    you.alert = alertFor(you, 2, now, []);
  }
  if (scene === "checkin") {
    you.checkin = {
      id: "c_mock1",
      prompt: "Hey, it's Wingman. Quick check-in: where are you right now, and who are you with?",
      trigger: "scheduled",
      askedAt: now,
      deadline: now + MIN,
      status: "pending",
      autoListen: true,
    };
  }
}

function alertFor(m: MemberView, stage: 1 | 2 | 3, now: number, acks: AlertState["acks"]): AlertState {
  return {
    memberId: m.id,
    memberName: m.name,
    stage,
    stageSince: now - 10_000,
    startedAt: now - 70_000,
    nextEscalationAt: stage < 3 ? now + 2 * MIN : null,
    trigger: m.risk.summary,
    acks,
    bystander: stage >= 2,
    contactNotified: stage >= 3,
  };
}

function view(w: World, now: number): GroupView {
  return {
    protocolVersion: PROTOCOL_VERSION,
    code: w.code,
    name: "Friday night",
    now,
    status: w.ended ? "ended" : "active",
    demo: true,
    createdAt: w.createdAt,
    you: w.youId,
    members: w.members,
    alerts: w.members.flatMap((m) => (m.alert ? [m.alert] : [])),
    timers: {
      checkinEveryMs: 30 * MIN,
      checkinTimeoutMs: MIN,
      fallConfirmMs: 3000,
      fallWindowMs: 15 * MIN,
      stillnessMs: 20 * MIN,
      untouchedMs: 45 * MIN,
      heartbeatLostMs: 2 * MIN,
      l1ToL2Ms: 3 * MIN,
      l2ToL3Ms: 4 * MIN,
      ackHoldMs: 10 * MIN,
      probeCooldownMs: 3 * MIN,
    },
    links: { joinUrl: `https://wingman.app/j/${w.code}`, deepLink: `wingman://join/${w.code}` },
    events: [],
    notifications: [],
    engines: { scorer: "mock", notifier: "simulated", push: "none" },
  };
}

function broadcast(w: World) {
  const now = Date.now();
  for (const s of w.sockets) s.deliver({ t: "view", view: view(w, now) });
}

/** Switch the fake world to a scene (screenshots / demo). */
export function setMockScene(scene: MockScene) {
  if (!world) world = build("Yeyito", Date.now());
  applyScene(world, scene, Date.now());
  broadcast(world);
  if (scene === "friend-alert") {
    const a = world.members.find((m) => m.id === "m_maya")!.alert!;
    for (const s of world.sockets) s.deliver({ t: "alert", alert: a, you: false, title: "Maya may need help", body: a.trigger });
  }
}

function joinResponse(w: World): JoinResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    code: w.code,
    memberId: w.youId,
    key: "mock-key",
    links: { joinUrl: `https://wingman.app/j/${w.code}`, deepLink: `wingman://join/${w.code}` },
    wsPath: "",
    view: view(w, Date.now()),
  };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function mockFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const path = new URL(url).pathname;
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const now = Date.now();
  await new Promise((r) => setTimeout(r, 120));
  if (path === "/api/health") return json({ ok: true, protocolVersion: PROTOCOL_VERSION });
  if (path === "/api/groups" && init.method === "POST") {
    world = build(body.member?.name || "You", now);
    return json(joinResponse(world));
  }
  const m = path.match(/^\/api\/groups\/([A-Z0-9]+)(\/.*)?$/i);
  if (!m) return json({ error: "not found" }, 404);
  const rest = m[2] ?? "";
  if (rest === "/join") {
    world = build(body.name || "You", now);
    world.code = m[1]!.toUpperCase();
    return json(joinResponse(world));
  }
  const w = world;
  if (!w || w.ended) return json({ error: "group not found or ended" }, 404);
  if (rest === "" || rest === "/view") return json(view(w, now));
  if (rest === "/end") {
    w.ended = true;
    for (const s of w.sockets) s.deliver({ t: "ended", reason: "ended by a member" });
    world = null;
    return json({ ok: true });
  }
  const mm = rest.match(/^\/members\/([^/]+)\/([^/]+)(?:\/([^/]+)\/([^/]+))?$/);
  if (!mm) return json({ error: "not found" }, 404);
  const [, id, action, cid] = mm;
  const target = w.members.find((x) => x.id === id);
  if (!target) return json({ error: "unknown member" }, 404);
  switch (action) {
    case "signals":
      return json({ ok: true, now });
    case "ack":
      target.alert?.acks.push({ by: w.youId, byName: w.members[0]!.name, kind: "on_my_way", at: now });
      break;
    case "resolve":
      if (target.isYou && body.pin !== "1234" && body.pin !== mockPin) return json({ ok: false, attemptsLeft: 2 }, 401);
      target.alert = null;
      target.risk = { score: 4, level: "ok", reasons: [], summary: "all good" };
      w.scene = "calm";
      break;
    case "checkins":
      if (cid) {
        const c = target.checkin;
        if (!c) return json({ ok: false, error: "not pending" }, 409);
        await new Promise((r) => setTimeout(r, 900));
        const done: Checkin = {
          ...c,
          status: "done",
          outcome: "ok",
          answeredAt: Date.now(),
          result: { engine: "mock", transcript: body.text ?? "", responded: true, coherent: true, impairment: 0.05, signs: [], reason: "clear and oriented", latencyMs: 900 },
        };
        target.checkin = null;
        target.lastCheckin = done;
        broadcast(w);
        return json({ ok: true, checkin: done });
      }
      applyScene(w, "checkin", now);
      broadcast(w);
      return json({ ok: true, checkin: target.checkin });
    case "leave":
      for (const s of w.sockets) s.deliver({ t: "left" });
      world = null;
      return json({ ok: true });
    default:
      return json({ ok: true });
  }
  broadcast(w);
  return json({ ok: true });
}

let mockPin = "";
export function setMockPin(pin: string) {
  mockPin = pin;
}

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  constructor(_url: string) {
    setTimeout(() => {
      if (!world) {
        this.readyState = 3;
        this.onclose?.({});
        return;
      }
      this.readyState = 1;
      world.sockets.add(this);
      this.onopen?.({});
      this.deliver({ t: "hello", protocolVersion: PROTOCOL_VERSION, you: world.youId, view: view(world, Date.now()) });
    }, 50);
  }
  deliver(m: ServerMsg) {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(m) });
  }
  send(_data: string) {}
  close() {
    this.readyState = 3;
    world?.sockets.delete(this);
  }
}

export function mockDeps(): ClientDeps {
  return { fetch: mockFetch, WebSocket: FakeSocket };
}
