// Optional push notifications for backgrounded phones. Default "none": tokens are stored, nothing is sent.
// EXPO_PUSH=1 sends through the public Expo push API (no credentials needed for ExponentPushToken[...] tokens).
// Raw APNs tokens would need an Apple key; they are stored but not sent.

import type { PushTokenRequest } from "../shared/types.ts";

export interface PushMessage {
  token: PushTokenRequest;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface Pusher {
  name: "expo" | "none";
  send(m: PushMessage): Promise<{ ok: boolean; detail: string }>;
}

export function createPusher(env = process.env): Pusher {
  if (env.EXPO_PUSH === "1" || env.EXPO_PUSH === "true") return expo(env.EXPO_ACCESS_TOKEN);
  return { name: "none", send: async () => ({ ok: false, detail: "push disabled" }) };
}

function expo(accessToken?: string): Pusher {
  return {
    name: "expo",
    async send(m) {
      if (m.token.kind !== "expo") return { ok: false, detail: "apns tokens need an Apple key; not sent" };
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ to: m.token.token, title: m.title, body: m.body, data: m.data, sound: "default", priority: "high", interruptionLevel: "time-sensitive" }),
      });
      const json: any = await res.json().catch(() => ({}));
      const d = json?.data;
      const ok = res.ok && (Array.isArray(d) ? d[0]?.status : d?.status) === "ok";
      return { ok, detail: ok ? "expo push sent" : `expo HTTP ${res.status}: ${JSON.stringify(json?.errors ?? d ?? {}).slice(0, 160)}` };
    },
  };
}
