// Level-3 notifier: Twilio SMS (+ optional voice call) when TWILIO_* is configured, otherwise a clearly
// simulated notifier that records exactly what would have been sent.

import type { Notification } from "../shared/types.ts";

export interface Alert {
  to: string;
  toName: string;
  body: string;
  /** short sentence for a text-to-speech voice call */
  speech: string;
}

export interface Notifier {
  name: "twilio" | "simulated";
  send(a: Alert): Promise<Notification[]>;
}

export function createNotifier(env = process.env): Notifier {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = env;
  if (sid && token && from) return twilio(sid, token, from, env.TWILIO_VOICE === "true");
  return simulated();
}

function simulated(): Notifier {
  return {
    name: "simulated",
    async send(a) {
      console.log(`[notifier] SIMULATED SMS to ${a.toName} <${a.to}>: ${a.body}`);
      return [{ at: Date.now(), channel: "sms", to: a.to, toName: a.toName, body: a.body, simulated: true, ok: true, detail: "simulated (no Twilio configured)" }];
    },
  };
}

function twilio(sid: string, token: string, from: string, voice: boolean): Notifier {
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  async function post(path: string, form: Record<string, string>) {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
    const json: any = await res.json().catch(() => ({}));
    return { ok: res.ok, detail: res.ok ? `twilio ${json.sid ?? "ok"}` : `twilio HTTP ${res.status}: ${json.message ?? ""}` };
  }
  return {
    name: "twilio",
    async send(a) {
      const out: Notification[] = [];
      const sms = await post("Messages.json", { To: a.to, From: from, Body: a.body }).catch((e) => ({ ok: false, detail: String(e) }));
      out.push({ at: Date.now(), channel: "sms", to: a.to, toName: a.toName, body: a.body, simulated: false, ...sms });
      if (voice) {
        const twiml = `<Response><Say voice="alice">${escapeXml(a.speech)}</Say><Pause length="1"/><Say voice="alice">${escapeXml(a.speech)}</Say></Response>`;
        const call = await post("Calls.json", { To: a.to, From: from, Twiml: twiml }).catch((e) => ({ ok: false, detail: String(e) }));
        out.push({ at: Date.now(), channel: "voice", to: a.to, toName: a.toName, body: a.speech, simulated: false, ...call });
      }
      return out;
    },
  };
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
