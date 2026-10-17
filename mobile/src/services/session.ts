// Glue between the store and the server: the client, the live socket, and the side effects of server messages
// (alarm, haptics, notifications). Screens call these functions; they never talk to the client directly.

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import type { ClientMsg, JoinResponse, MemberSetup, ServerMsg, SignalBatch } from "@shared/protocol";
import { ApiError, WingmanClient } from "../api/client";
import { mockDeps } from "../api/mock";
import { dispatch, getState, loadPin } from "../state/store";
import type { Membership } from "../state/reducer";
import * as alarm from "./alarm";

let live: ReturnType<WingmanClient["connect"]> | null = null;
let liveFor = "";

export function client(serverUrl = getState().serverUrl, m: Membership | null = getState().membership) {
  const deps = serverUrl.startsWith("mock") ? mockDeps() : {};
  return new WingmanClient(serverUrl.startsWith("mock") ? "https://mock.wingman" : serverUrl, m ? { code: m.code, memberId: m.memberId, key: m.key } : null, deps);
}

async function setup(): Promise<MemberSetup> {
  const p = getState().profile;
  const pin = (await loadPin()) ?? "";
  return {
    name: p.name,
    pin,
    phone: p.phone || undefined,
    medical: p.medical || undefined,
    emergencyContact: p.contactName || p.contactPhone ? { name: p.contactName, phone: p.contactPhone } : undefined,
    consent: true,
    tzOffset: new Date().getTimezoneOffset(),
  };
}

function joined(r: JoinResponse) {
  const membership: Membership = { code: r.code, memberId: r.memberId, key: r.key, serverUrl: getState().serverUrl };
  dispatch({ type: "joined", membership, view: r.view, at: Date.now() });
  connect();
}

export async function startNight() {
  const s = await setup();
  joined(await client(undefined, null).createGroup({ member: s, groupName: `${s.name}'s night out` }));
}

export async function joinNight(code: string) {
  joined(await client(undefined, null).join(code, await setup()));
}

/** Open (or re-open) the live socket for the current membership. Idempotent. */
export function connect() {
  const m = getState().membership;
  if (!m) return disconnect();
  const id = `${m.serverUrl}|${m.code}|${m.memberId}`;
  if (live && liveFor === id) return;
  disconnect();
  liveFor = id;
  live = client(m.serverUrl, m).connect({
    onStatus: (status) => {
      dispatch({ type: "connection", status });
      if (status === "closed") checkStillExists();
    },
    onMessage: onMessage,
  });
}

/** The socket dropped: if the server no longer knows the group (ended, or restarted), stop retrying and go home. */
async function checkStillExists() {
  const m = getState().membership;
  if (!m) return;
  try {
    await client(m.serverUrl, m).view();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403) && getState().membership === m) {
      disconnect();
      alarm.stopAll();
      dispatch({ type: "left", reason: "That night isn't running any more. Start a new one or join again." });
    }
  }
}

export function disconnect() {
  live?.close();
  live = null;
  liveFor = "";
}

export function reconnectNow() {
  live?.reconnectNow();
}

function onMessage(msg: ServerMsg) {
  const before = getState();
  dispatch({ type: "server", msg, at: Date.now() });
  const after = getState();
  // On screen, the takeover owns the alarm. In the background (dev build), a notification is all we can do.
  if (AppState.currentState !== "active") {
    if (msg.t === "alert" && !msg.you) alarm.notify(msg.title, msg.body);
    if (msg.t === "alert" && msg.you && msg.alert.stage >= 2) alarm.notify("Wingman: are you OK?", "Your friends were alerted. Open Wingman.");
    if (msg.t === "checkin") alarm.notify("Wingman check-in", msg.checkin.prompt);
  }
  if (msg.t === "ended" || msg.t === "left" || (before.membership && !after.membership)) {
    disconnect();
    alarm.stopAll();
  }
}

/** Send a signal batch: over the socket when it's open, else HTTP. */
export function sendSignals(b: SignalBatch) {
  if (!getState().membership) return;
  const msg: ClientMsg = { t: "signals", ...b };
  if (live?.send(msg)) return;
  client()
    .signals(b)
    .catch(() => {});
}

export const ack = (memberId: string) => client().ack(memberId);
export const foundOk = (memberId: string) => client().resolve(memberId);
export const askCheckin = (memberId?: string) => client().askCheckin(memberId);
export const answerCheckin = (cid: string, a: Parameters<WingmanClient["answerCheckin"]>[1]) => client().answerCheckin(cid, a);
export const escalate = (memberId: string) => client().escalate(memberId);

/** "I'm OK" with the PIN. Returns null on success, else a message for the keypad. */
export async function cancelOwnAlert(pin: string): Promise<string | null> {
  const self = getState().membership;
  if (!self) return null;
  try {
    await client().resolve(self.memberId, pin);
    return null;
  } catch (e) {
    if (e instanceof ApiError) {
      const b = (e.body ?? {}) as { attemptsLeft?: number; lockedUntil?: number };
      if (e.status === 423 || b.lockedUntil) return "Too many tries. Wait 30 seconds.";
      if (e.status === 401) return b.attemptsLeft !== undefined ? `Wrong PIN · ${b.attemptsLeft} ${b.attemptsLeft === 1 ? "try" : "tries"} left` : "Wrong PIN";
    }
    return (e as Error).message;
  }
}

/** End the night for everyone (deletes the group), or just leave it. */
export async function endNight(forEveryone: boolean) {
  const c = client();
  try {
    if (forEveryone) await c.endNight();
    else await c.leave();
  } catch (e) {
    // 404/403 means the group is already gone; anything else, still drop local state so the user isn't stuck.
    if (!(e instanceof ApiError)) throw e;
  }
  disconnect();
  alarm.stopAll();
  dispatch({ type: "left", reason: null });
}

/** Send an Expo push token to the server if this build can get one (needs an EAS projectId; optional). */
export async function registerPush() {
  if (Platform.OS === "web" || !getState().membership) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await client().pushToken({ kind: "expo", token: data, platform: Platform.OS === "ios" ? "ios" : "android" });
  } catch {}
}
