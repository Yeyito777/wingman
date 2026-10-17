// HTTP + WebSocket server for groups (protocol: shared/protocol.ts, docs/PROTOCOL.md). State is in memory only.

import type { Server, ServerWebSocket } from "bun";
import QRCode from "qrcode";
import { MAX_MEMBERS } from "../shared/config.ts";
import stagePage from "../client/stage.html";
import webPage from "../client/web.html";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  PROTOCOL_VERSION,
  normalizeJoinCode,
  type ClientMsg,
  type CreateDemoRequest,
  type CreateGroupRequest,
  type DemoActionRequest,
  type GroupPreview,
  type JoinResponse,
  type MemberSetup,
  type ServerMsg,
  type SignalBatch,
} from "../shared/types.ts";
import { CANNED, Group, type GroupHooks, type Member } from "./group.ts";
import { createNotifier, type Notifier } from "./notifier.ts";
import { createPusher, type Pusher } from "./push.ts";
import { availableEngines, geminiModels, scoreCheckin, type ScoreRequest } from "./scorer.ts";

const PUBLIC_DIR = new URL("../../public/", import.meta.url).pathname;
const GROUP_TTL_MS = 12 * 60 * 60_000;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const DEMO_FRIENDS = ["Sam", "Maya", "Leo"];
const DEMO_MEDICAL: Record<string, string> = {
  Sam: "No allergies.",
  Maya: "Penicillin allergy. Asthma: inhaler in her bag.",
  Leo: "Type 1 diabetes: glucose tabs in left jacket pocket.",
};

interface WsData {
  code: string;
  /** null for the stage view */
  memberId: string | null;
}

export interface AppOptions {
  port?: number;
  hostname?: string;
  /** force a scorer engine order, e.g. ["mock"] in tests */
  engines?: ReturnType<typeof availableEngines>;
  notifier?: Notifier;
  pusher?: Pusher;
  tickMs?: number;
  quiet?: boolean;
}

type Req = Request & { params: Record<string, string> };

export function startServer(opts: AppOptions = {}) {
  const groups = new Map<string, Group>();
  const notifier = opts.notifier ?? createNotifier();
  const pusher = opts.pusher ?? createPusher();
  const engines = opts.engines ?? availableEngines();
  const scorerName = engines[0] === "gemini" ? `gemini (${geminiModels()[0]})` : engines[0] === "openai" ? `openai (${process.env.OPENAI_MODEL || "gpt-4o-mini"})` : "mock (offline heuristics)";
  const log = (...a: unknown[]) => !opts.quiet && console.log(...a);
  let server: Server<WsData>;

  const topic = (g: Group, memberId: string | null) => (memberId ? `${g.code}:m:${memberId}` : `${g.code}:stage`);
  const publish = (g: Group, memberId: string | null, msg: ServerMsg) => server?.publish(topic(g, memberId), JSON.stringify(msg));
  const publishViews = (g: Group) => {
    const now = Date.now();
    for (const m of g.members.values()) if (m.sockets > 0) publish(g, m.id, { t: "view", view: g.view(m.id, now) });
    publish(g, null, { t: "view", view: g.view(null, now) });
  };
  const hooks: GroupHooks = {
    notifier,
    pusher,
    scorerName,
    score: (req: ScoreRequest) => scoreCheckin(req, engines),
    broadcast: (g) => {
      if (server && g.status === "active" && g.changed(Date.now())) publishViews(g);
    },
    send: (g, to, build) => {
      const ids = to === "all" ? [...g.members.keys()] : to;
      for (const id of ids) publish(g, id, build(id));
      if (to === "all") publish(g, null, build(null));
    },
  };

  const newCode = () => {
    for (;;) {
      const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
      const code = [...bytes].map((b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join("");
      if (!groups.has(code)) return code;
    }
  };
  const getGroup = (code: string) => {
    const g = groups.get(normalizeJoinCode(code ?? ""));
    return g && g.status === "active" ? g : null;
  };
  const keyOf = (req: Request) => {
    const auth = req.headers.get("authorization");
    if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    return req.headers.get("x-wingman-key") ?? new URL(req.url).searchParams.get("k");
  };
  const endGroup = (g: Group, reason: string) => {
    g.status = "ended";
    groups.delete(g.code);
    hooks.send(g, "all", () => ({ t: "ended", reason }));
    log(`[group ${g.code}] ended (${reason}); all data deleted`);
  };
  const afterAction = (g: Group) => {
    g.tick(Date.now());
    publishViews(g);
  };
  const joinResponse = (g: Group, m: Member): JoinResponse => ({
    protocolVersion: PROTOCOL_VERSION,
    code: g.code,
    memberId: m.id,
    key: m.key,
    links: g.links,
    wsPath: `/ws?g=${g.code}&m=${m.id}&k=${m.key}`,
    view: g.view(m.id, Date.now()),
  });

  /** Validate a create/join body; returns an error string or the cleaned setup. */
  const parseSetup = (b: any): MemberSetup | string => {
    if (!b || typeof b !== "object") return "body must be a JSON object";
    if (typeof b.name !== "string" || !b.name.trim() || b.name.trim().length > 30) return "name (1-30 chars) is required";
    if (!/^\d{4,8}$/.test(String(b.pin ?? ""))) return "a 4-8 digit PIN is required";
    if (b.consent !== true) return "consent: true is required (you agree to be guarded tonight and to guard the others)";
    return { ...b, pin: String(b.pin) };
  };

  /** Wrap a group API handler with lookup + member auth. `self`: the caller must be the :id member. */
  const api =
    (need: "member" | "self" | "demo", fn: (g: Group, req: Req, caller: Member | null, target: Member | null) => Promise<Response> | Response) =>
    async (req: Req) => {
      const g = getGroup(req.params.code!);
      if (!g) return json({ error: "group not found or the night has ended" }, 404);
      const key = keyOf(req);
      const caller = g.memberByKey(key);
      const isStage = !!key && key === g.stageKey;
      if (need === "demo") {
        if (!g.demo) return json({ error: "demo controls are only available in demo groups" }, 403);
        if (!caller && !isStage) return json({ error: "forbidden" }, 403);
      } else if (!caller) return json({ error: "forbidden" }, 403);
      let target: Member | null = null;
      if (req.params.id) {
        target = g.members.get(req.params.id) ?? null;
        if (!target) return json({ error: "unknown member" }, 404);
        if (need === "self" && target !== caller) return json({ error: "only for yourself" }, 403);
      }
      try {
        return await fn(g, req, caller, target);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: String((e as Error).message ?? e) }, 500);
      }
    };

  const body = async (req: Request): Promise<any> => {
    const t = await req.text();
    if (!t) return {};
    try {
      return JSON.parse(t);
    } catch {
      throw new HttpError(400, "invalid JSON");
    }
  };

  const createGroup = (req: Request, opts2: { name?: string; demo?: boolean }) => {
    const g = new Group(newCode(), opts2, hooks);
    g.baseUrl = baseUrl(req);
    groups.set(g.code, g);
    log(`[group ${g.code}] created${g.demo ? " (demo)" : ""}`);
    return g;
  };

  server = Bun.serve<WsData>({
    port: opts.port ?? Number(process.env.PORT ?? 3000),
    hostname: opts.hostname ?? "0.0.0.0",
    development: process.env.NODE_ENV !== "production" && !opts.quiet ? { hmr: false, console: false } : false,
    routes: {
      "/": webPage,
      "/g/:code": webPage,
      "/stage/:code": stagePage,
      "/j/:code": (req: Req) => joinPage(normalizeJoinCode(req.params.code!), !!getGroup(req.params.code!)),

      "/api/health": () => json({ ok: true, protocolVersion: PROTOCOL_VERSION, scorer: scorerName, engines, notifier: notifier.name, push: pusher.name, groups: groups.size }),

      "/api/qr": async (req: Request) => {
        const text = new URL(req.url).searchParams.get("text") ?? "";
        if (!text || text.length > 500) return json({ error: "bad text" }, 400);
        const svg = await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#0b0f19", light: "#ffffff" } });
        return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "max-age=3600" } });
      },

      "/api/groups": {
        POST: async (req: Request) => {
          const b = (await body(req).catch(() => null)) as CreateGroupRequest | null;
          const setup = parseSetup(b?.member);
          if (typeof setup === "string") return json({ error: setup }, 400);
          const g = createGroup(req, { name: b!.groupName, demo: !!b!.demo });
          const m = g.addMember(setup, Date.now());
          afterAction(g);
          return json(joinResponse(g, m));
        },
      },

      "/api/demo": {
        POST: async (req: Request) => {
          const b = ((await body(req).catch(() => ({}))) ?? {}) as CreateDemoRequest;
          const friends = Array.isArray(b.friends) && b.friends.length ? b.friends.map(String).slice(0, 6) : DEMO_FRIENDS;
          const g = createGroup(req, { name: b.presenterName ? `${b.presenterName}'s night out` : "Friday night out", demo: true });
          const now = Date.now();
          for (const name of friends) {
            g.addMember({ name, pin: "0000", consent: true, medical: DEMO_MEDICAL[name] ?? "", emergencyContact: { name: name === "Maya" ? "Her mom" : "Mom", phone: "+1 416 555 0199" } }, now, true);
          }
          afterAction(g);
          return json({ code: g.code, stageKey: g.stageKey, stageUrl: `${g.baseUrl}/stage/${g.code}?k=${g.stageKey}`, links: g.links });
        },
      },

      "/api/groups/:code": {
        GET: (req: Req) => {
          const g = getGroup(req.params.code!);
          if (!g) return json({ error: "group not found or the night has ended" }, 404);
          const p: GroupPreview = { protocolVersion: PROTOCOL_VERSION, code: g.code, name: g.name, status: g.status, demo: g.demo, members: [...g.members.values()].map((m) => ({ name: m.name, color: m.color })) };
          return json(p);
        },
      },

      "/api/groups/:code/join": {
        POST: async (req: Req) => {
          const g = getGroup(req.params.code!);
          if (!g) return json({ error: "group not found or the night has ended" }, 404);
          if (g.members.size >= MAX_MEMBERS) return json({ error: "group is full" }, 409);
          const setup = parseSetup(await body(req).catch(() => null));
          if (typeof setup === "string") return json({ error: setup }, 400);
          const m = g.addMember(setup, Date.now());
          afterAction(g);
          return json(joinResponse(g, m));
        },
      },

      "/api/groups/:code/view": {
        GET: api("member", (g, _req, caller) => json(g.view(caller!.id, Date.now()))),
      },

      "/api/groups/:code/members/:id/signals": {
        POST: api("self", async (g, req, m) => {
          const now = Date.now();
          g.signals(m!, (await body(req)) as SignalBatch, now);
          return json({ ok: true, now });
        }),
      },

      "/api/groups/:code/members/:id/checkins": {
        POST: api("member", async (g, req, caller, target) => {
          const b = await body(req);
          const trigger = caller === target ? "manual" : `requested by ${caller!.name}`;
          const c = g.askCheckin(target!, trigger, Date.now(), typeof b.prompt === "string" ? b.prompt : undefined);
          afterAction(g);
          return json({ ok: true, checkin: c });
        }),
      },

      "/api/groups/:code/members/:id/checkins/:cid/answer": {
        POST: api("self", async (g, req, m) => {
          const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
          let ans: Parameters<Group["answerCheckin"]>[2];
          if (type === "application/json" || type === "") {
            const b = await body(req);
            if (typeof b.audio === "string" && b.audio) {
              const data = new Uint8Array(Buffer.from(b.audio, "base64"));
              if (data.byteLength > MAX_AUDIO_BYTES) return json({ ok: false, error: "audio too large" }, 413);
              ans = { audio: { data, mime: String(b.mime || "audio/m4a") }, source: "voice" };
            } else ans = { text: String(b.text ?? "").slice(0, 1000), source: "typed" };
          } else {
            const data = new Uint8Array(await req.arrayBuffer());
            if (data.byteLength > MAX_AUDIO_BYTES) return json({ ok: false, error: "audio too large" }, 413);
            ans = { audio: { data, mime: type }, source: "voice" };
          }
          const r = await g.answerCheckin(m!, req.params.cid!, ans);
          if (g.status === "active") afterAction(g);
          return json(r, r.ok ? 200 : 409);
        }),
      },

      "/api/groups/:code/members/:id/ack": {
        POST: api("member", (g, _req, caller, target) => {
          if (caller === target) return json({ ok: false, error: "you can't acknowledge your own alert; enter your PIN instead" }, 400);
          if (target!.esc.stage === 0) return json({ ok: false, error: `${target!.name} is not in alert` }, 409);
          g.ack(target!, caller!, Date.now());
          afterAction(g);
          return json({ ok: true });
        }),
      },

      "/api/groups/:code/members/:id/resolve": {
        POST: api("member", async (g, req, caller, target) => {
          const b = await body(req);
          const now = Date.now();
          if (caller === target) {
            const r = g.checkPin(target!, String(b.pin ?? ""), now);
            afterAction(g);
            return json(r, r.ok ? 200 : r.lockedUntil ? 423 : 401);
          }
          const note = typeof b.note === "string" && b.note.trim() ? `: ${b.note.trim().slice(0, 100)}` : "";
          g.resolve(target!, caller!.name, `found & OK in person${note}`, now);
          afterAction(g);
          return json({ ok: true });
        }),
      },

      "/api/groups/:code/members/:id/escalate": {
        POST: api("member", (g, _req, caller, target) => {
          g.escalate(target!, caller!.name, Date.now());
          afterAction(g);
          return json({ ok: true });
        }),
      },

      "/api/groups/:code/members/:id/push-token": {
        POST: api("self", async (g, req, m) => {
          const b = await body(req);
          if (typeof b.token !== "string" || !b.token) return json({ ok: false, error: "token is required" }, 400);
          m!.pushToken = { kind: b.kind === "apns" ? "apns" : "expo", token: b.token.slice(0, 200), platform: b.platform === "android" ? "android" : "ios" };
          afterAction(g);
          return json({ ok: true });
        }),
      },

      "/api/groups/:code/members/:id/settings": {
        POST: api("self", async (g, req, m) => {
          const b = await body(req);
          if (b.shareLocation === "always" || b.shareLocation === "alert") m!.shareLocation = b.shareLocation;
          if (typeof b.phone === "string") m!.phone = b.phone.trim().slice(0, 30);
          if (typeof b.medical === "string") m!.medical = b.medical.trim().slice(0, 600);
          if (b.emergencyContact && typeof b.emergencyContact === "object") {
            m!.contact = { name: String(b.emergencyContact.name ?? "").trim().slice(0, 40) || "Emergency contact", phone: String(b.emergencyContact.phone ?? "").trim().slice(0, 30) };
          }
          afterAction(g);
          return json({ ok: true });
        }),
      },

      "/api/groups/:code/members/:id/leave": {
        POST: api("self", (g, _req, m) => {
          publish(g, m!.id, { t: "left" });
          g.removeMember(m!, Date.now());
          if ([...g.members.values()].every((x) => x.simulated)) endGroup(g, "everyone left");
          else afterAction(g);
          return json({ ok: true });
        }),
      },

      "/api/groups/:code/end": {
        POST: api("member", (g, _req, caller) => {
          endGroup(g, `night ended by ${caller!.name}`);
          return json({ ok: true, deleted: true });
        }),
      },

      "/api/groups/:code/demo/:action": {
        POST: api("demo", async (g, req, caller) => {
          const b = (await body(req)) as DemoActionRequest & Record<string, any>;
          return demoAction(g, req.params.action!, b, caller);
        }),
      },
    },

    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const g = getGroup(url.searchParams.get("g") ?? "");
        if (!g) return new Response("group not found", { status: 404 });
        const k = url.searchParams.get("k");
        const mid = url.searchParams.get("m");
        let memberId: string | null = null;
        if (mid) {
          const m = g.members.get(mid);
          if (!m || m.key !== k) return new Response("forbidden", { status: 403 });
          memberId = m.id;
        } else if (!k || k !== g.stageKey) {
          const m = g.memberByKey(k);
          if (!m) return new Response("forbidden", { status: 403 });
          memberId = m.id;
        }
        if (srv.upgrade(req, { data: { code: g.code, memberId } })) return undefined;
        return new Response("upgrade failed", { status: 400 });
      }
      // Static files (PWA manifest, icons, demo audio).
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (path && !path.includes("..")) {
        const f = Bun.file(PUBLIC_DIR + path);
        if (await f.exists()) return new Response(f);
      }
      return new Response("Not found", { status: 404 });
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        const g = getGroup(ws.data.code);
        if (!g) return ws.close();
        const m = ws.data.memberId ? g.members.get(ws.data.memberId) : undefined;
        if (ws.data.memberId && !m) return ws.close();
        ws.subscribe(topic(g, m?.id ?? null));
        const now = Date.now();
        if (m) {
          m.sockets++;
          if (!m.offlineSimulated) {
            m.lastHeartbeatAt = m.lastSeenAt = now;
            m.appState = "foreground";
          }
        }
        ws.send(JSON.stringify({ t: "hello", protocolVersion: PROTOCOL_VERSION, you: m?.id ?? null, view: g.view(m?.id ?? null, now) } satisfies ServerMsg));
        if (m) afterAction(g);
      },
      message(ws: ServerWebSocket<WsData>, raw) {
        const g = getGroup(ws.data.code);
        const m = g && ws.data.memberId ? g.members.get(ws.data.memberId) : undefined;
        if (!g || !m) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return void ws.send(JSON.stringify({ t: "error", error: "invalid JSON" } satisfies ServerMsg));
        }
        const now = Date.now();
        if (msg.t === "ping") {
          g.signals(m, { heartbeat: true }, now);
          ws.send(JSON.stringify({ t: "pong", now } satisfies ServerMsg));
        } else if (msg.t === "signals") {
          g.signals(m, msg, now);
        } else ws.send(JSON.stringify({ t: "error", error: `unknown message type` } satisfies ServerMsg));
      },
      close(ws: ServerWebSocket<WsData>) {
        const g = getGroup(ws.data.code);
        const m = g && ws.data.memberId ? g.members.get(ws.data.memberId) : undefined;
        if (!g || !m) return;
        m.sockets = Math.max(0, m.sockets - 1);
        publishViews(g);
      },
    },
  });

  // ---------- demo actions (stage storyline) ----------

  async function demoAction(g: Group, action: string, b: DemoActionRequest & Record<string, any>, caller: Member | null): Promise<Response> {
    const now = Date.now();
    const subject = () => {
      const id = b.target ?? g.demoSubjectId;
      const m = (id && g.members.get(id)) || [...g.members.values()].find((x) => !x.simulated) || [...g.members.values()].find((x) => x.simulated);
      if (!m) throw new HttpError(409, "no members in the group yet");
      return m;
    };
    const friendOf = (s: Member) => {
      if (b.by) {
        const m = g.members.get(b.by);
        if (!m) throw new HttpError(404, "unknown member for by");
        return m;
      }
      return [...g.members.values()].find((x) => x !== s && x.simulated) ?? [...g.members.values()].find((x) => x !== s) ?? null;
    };
    switch (action) {
      case "subject": {
        const m = b.target ? g.members.get(b.target) : null;
        if (!m) return json({ error: "target member required" }, 400);
        g.demoSubjectId = m.id;
        break;
      }
      case "mode":
        if (b.mode === "canned" || b.mode === "live") g.demoAnswerMode = b.mode;
        break;
      case "timers":
        if (b.timers) g.setTimers(b.timers);
        break;
      case "fall": {
        const s = subject();
        s.scripted = true;
        g.fall(s, now, 3.4, true);
        break;
      }
      case "slurred":
      case "coherent": {
        const s = subject();
        s.scripted = true;
        const c = s.pendingCheckin ?? g.askCheckin(s, "demo", now);
        if (c.status !== "pending") return json({ error: "a check-in is already being scored" }, 409);
        afterAction(g);
        const delay = Math.max(0, Math.min(15_000, Number(b.delayMs ?? 2500)));
        const live = g.demoAnswerMode === "live";
        const run = async () => {
          if (live) {
            const data = new Uint8Array(await Bun.file(`${PUBLIC_DIR}demo-audio/${action}.wav`).arrayBuffer());
            // The canned text rides along: AI engines score the audio, and if they all fail the offline fallback
            // scores the script instead of treating unheard audio as a clear answer.
            await g.answerCheckin(s, c.id, { audio: { data, mime: "audio/wav" }, text: CANNED[action], source: `demo audio: ${action}` });
          } else {
            await g.answerCheckin(s, c.id, { text: CANNED[action], source: `demo script: ${action}`, canned: true });
          }
          if (g.status === "active") afterAction(g);
        };
        if (b.wait) {
          await Bun.sleep(delay);
          await run();
        } else setTimeout(() => run().catch(console.error), delay);
        return json({ ok: true, checkinId: c.id, mode: g.demoAnswerMode, subject: s.id });
      }
      case "miss": {
        const s = subject();
        s.scripted = true;
        const c = s.pendingCheckin ?? g.askCheckin(s, "demo", now);
        if (c.status === "pending") c.deadline = Math.min(c.deadline, now + Math.max(0, Number(b.afterMs ?? 3000)));
        break;
      }
      case "checkin": {
        const s = subject();
        g.askCheckin(s, "manual", now);
        break;
      }
      case "walk": {
        const s = subject();
        s.scripted = true;
        g.startWalk(s, now, Number(b.distM) || 350, Number(b.durationMs ?? 8000));
        break;
      }
      case "back":
        g.stopWalk(subject(), now);
        break;
      case "offline":
        subject().scripted = true;
        g.setOffline(subject(), true, now);
        break;
      case "online":
        g.setOffline(subject(), false, now);
        break;
      case "escalate":
        g.escalate(subject(), caller?.name ?? "demo panel", now);
        break;
      case "ack": {
        const s = subject();
        const f = friendOf(s);
        if (!f) return json({ error: "nobody to acknowledge" }, 409);
        if (s.esc.stage === 0) return json({ error: `${s.name} is not in alert` }, 409);
        g.ack(s, f, now);
        break;
      }
      case "resolve": {
        const s = subject();
        const f = friendOf(s);
        g.resolve(s, f?.name ?? "demo panel", f ? "found & OK in person" : "manual reset of the alert", now);
        break;
      }
      case "scene":
        g.newScene(subject(), now);
        break;
      case "reset":
        g.reset(now);
        break;
      default:
        return json({ error: `unknown demo action ${action}` }, 400);
    }
    afterAction(g);
    return json({ ok: true });
  }

  const loop = setInterval(() => {
    const now = Date.now();
    for (const g of groups.values()) {
      if (now - g.createdAt > GROUP_TTL_MS) endGroup(g, "expired after 12 h");
      else g.tick(now);
    }
  }, opts.tickMs ?? 250);


  return {
    server,
    groups,
    url: `http://localhost:${server.port}`,
    stop() {
      clearInterval(loop);
      server.stop(true);
    },
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

function baseUrl(req: Request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** /j/CODE: open the app via the deep link, show the code big, offer the web fallback. */
function joinPage(code: string, exists: boolean) {
  const deep = `wingman://join/${code}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join ${code} · Wingman</title><link rel="icon" href="/icon.svg">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#e8ecf5;font:17px/1.4 system-ui,-apple-system,sans-serif;text-align:center}
main{padding:28px;max-width:420px}.code{font:800 52px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;margin:18px 0;padding:18px;border-radius:18px;background:#151b2c}
a.btn{display:block;padding:16px;border-radius:14px;background:#7c5cff;color:#fff;font-weight:700;text-decoration:none;margin:10px 0}a.ghost{background:transparent;border:1px solid #2a3350;color:#cfd6ea}
p{color:#9aa4bf}</style></head><body><main><div style="font-size:44px">🪽</div><h1 style="margin:6px 0">Join the night out</h1>
${exists ? `<p>Open Wingman and enter this code, or tap below.</p><div class="code">${code}</div>
<a class="btn" href="${deep}">Open in the Wingman app</a><a class="btn ghost" href="/g/${code}">Join on the web instead</a>
<script>setTimeout(function(){location.href=${JSON.stringify(deep)}},300)</script>` : `<p>This group doesn't exist or the night has ended (all its data was deleted).</p>`}
</main></body></html>`;
  return new Response(html, { status: exists ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
