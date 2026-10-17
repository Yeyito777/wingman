// HTTP + WebSocket server. Pages are bundled on the fly by Bun's HTML imports; state is in memory.

import type { Server, ServerWebSocket } from "bun";
import QRCode from "qrcode";
import buddyPage from "../client/buddy.html";
import demoPage from "../client/demo.html";
import userPage from "../client/index.html";
import type { Role } from "../shared/types.ts";
import { createNotifier, type Notifier } from "./notifier.ts";
import { availableEngines, geminiModels, scoreCheckin, type ScoreRequest } from "./scorer.ts";
import { Session, type SessionSetup } from "./session.ts";

const PUBLIC_DIR = new URL("../../public/", import.meta.url).pathname;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

const CANNED = {
  slurred: "Uhh... m'fine... I'm at the... the place wi' the... lights. I dunno... where's Sam...",
  coherent: "I'm at the Rex on Queen Street with Sam and Priya, we're heading home in about an hour.",
};

interface WsData {
  sid: string;
  role: Role;
  buddyId?: string;
}

export interface AppOptions {
  port?: number;
  hostname?: string;
  /** force a scorer engine order, e.g. ["mock"] in tests */
  engines?: ReturnType<typeof availableEngines>;
  notifier?: Notifier;
  tickMs?: number;
  quiet?: boolean;
}

export function startServer(opts: AppOptions = {}) {
  const sessions = new Map<string, Session>();
  const notifier = opts.notifier ?? createNotifier();
  const engines = opts.engines ?? availableEngines();
  const scorerName = engines[0] === "gemini" ? `gemini (${geminiModels()[0]})` : engines[0] === "openai" ? `openai (${process.env.OPENAI_MODEL || "gpt-4o-mini"})` : "mock (offline heuristics)";
  const score = (req: ScoreRequest) => scoreCheckin(req, engines);
  let server: Server<WsData>;

  const broadcast = (s: Session) => {
    if (!server || !s.changed(Date.now())) return;
    publishViews(s);
  };
  const publishViews = (s: Session) => {
    const now = Date.now();
    server.publish(`${s.id}:user`, JSON.stringify({ t: "view", view: s.view("user", now) }));
    server.publish(`${s.id}:buddy`, JSON.stringify({ t: "view", view: s.view("buddy", now) }));
  };
  const hooks = { notifier, scorerName, broadcast, score };

  const getSession = (id: string) => {
    const s = sessions.get(id);
    return s && s.status === "active" ? s : null;
  };
  const roleOf = (req: Request, s: Session): Role | null => {
    const k = req.headers.get("x-wingman-key") ?? new URL(req.url).searchParams.get("k");
    if (k === s.userKey) return "user";
    if (k === s.inviteKey) return "buddy";
    return null;
  };
  const endSession = (s: Session, reason: string) => {
    s.status = "ended";
    sessions.delete(s.id);
    const msg = JSON.stringify({ t: "ended", reason });
    server.publish(`${s.id}:user`, msg);
    server.publish(`${s.id}:buddy`, msg);
    if (!opts.quiet) console.log(`[session ${s.id}] ended (${reason}); all data deleted`);
  };

  /** Wrap a per-session API handler with lookup + key check. */
  const api =
    (need: Role | "any", fn: (s: Session, req: Request & { params: Record<string, string> }, role: Role) => Promise<Response> | Response) =>
    async (req: Request & { params: Record<string, string> }) => {
      const s = getSession(req.params.id!);
      if (!s) return json({ error: "session not found or ended" }, 404);
      const role = roleOf(req, s);
      if (!role || (need !== "any" && role !== need)) return json({ error: "forbidden" }, 403);
      try {
        return await fn(s, req, role);
      } catch (e) {
        console.error(e);
        return json({ error: String((e as Error).message ?? e) }, 500);
      }
    };

  const afterAction = (s: Session) => {
    s.tick(Date.now());
    publishViews(s);
  };

  server = Bun.serve<WsData>({
    port: opts.port ?? Number(process.env.PORT ?? 3000),
    hostname: opts.hostname ?? "0.0.0.0",
    development: process.env.NODE_ENV !== "production" && !opts.quiet ? { hmr: false, console: false } : false,
    routes: {
      "/": userPage,
      "/me/:id": userPage,
      "/buddy/:id": buddyPage,
      "/demo/:id": demoPage,
      "/stage/:id": demoPage,

      "/api/health": () => json({ ok: true, scorer: scorerName, engines, notifier: notifier.name, sessions: sessions.size }),

      "/api/qr": async (req: Request) => {
        const text = new URL(req.url).searchParams.get("text") ?? "";
        if (!text || text.length > 500) return json({ error: "bad text" }, 400);
        const svg = await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#0b0f19", light: "#ffffff" } });
        return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "max-age=3600" } });
      },

      "/api/sessions": {
        POST: async (req: Request) => {
          const b = (await req.json().catch(() => null)) as SessionSetup | null;
          if (!b || typeof b.name !== "string" || !/^\d{4,8}$/.test(String(b.pin ?? ""))) {
            return json({ error: "name and a 4-8 digit PIN are required" }, 400);
          }
          const s = new Session({ ...b, pin: String(b.pin) }, hooks);
          s.baseUrl = baseUrl(req);
          sessions.set(s.id, s);
          if (!opts.quiet) console.log(`[session ${s.id}] started${s.demo ? " (demo mode)" : ""}`);
          return json({ id: s.id, userKey: s.userKey, inviteKey: s.inviteKey, inviteUrl: s.view("user", Date.now()).inviteUrl });
        },
      },

      "/api/s/:id": api("any", (s, _req, role) => json(s.view(role, Date.now()))),

      "/api/s/:id/signal": {
        POST: api("any", async (s, req, role) => {
          const b: any = JSON.parse((await req.text()) || "{}");
          const now = Date.now();
          if (role === "buddy") {
            if (b.fix) s.buddyFix(String(b.buddyId), now, b.fix);
            return json({ ok: true });
          }
          if (b.hidden) s.background(now);
          if (b.hb) s.heartbeat(now, b.battery);
          if (b.motion) s.motion(now);
          if (b.interaction) s.interaction(now);
          if (b.fix) s.fix(now, b.fix);
          if (b.sensors) s.setSensors(b.sensors);
          if (b.fall) {
            s.fall(now, Number(b.fall.peakG) || null);
            afterAction(s);
          }
          return json({ ok: true, now });
        }),
      },

      "/api/s/:id/checkin": {
        POST: api("user", (s) => {
          const c = s.askCheckin("manual", Date.now());
          afterAction(s);
          return json({ ok: true, checkin: c });
        }),
      },

      "/api/s/:id/checkin/:cid/answer": {
        POST: api("user", async (s, req) => {
          const type = req.headers.get("content-type") ?? "";
          let ans: Parameters<Session["answerCheckin"]>[1];
          if (type.startsWith("application/json")) {
            const b: any = await req.json();
            ans = { text: String(b.text ?? "").slice(0, 1000), source: "typed" };
          } else {
            const data = new Uint8Array(await req.arrayBuffer());
            if (data.byteLength > MAX_AUDIO_BYTES) return json({ error: "audio too large" }, 413);
            ans = { audio: { data, mime: type.split(";")[0] || "audio/wav" }, source: "voice" };
          }
          const r = await s.answerCheckin(req.params.cid!, ans);
          afterAction(s);
          return json(r, r.ok ? 200 : 409);
        }),
      },

      "/api/s/:id/pin": {
        POST: api("user", async (s, req) => {
          const b: any = await req.json();
          const r = s.checkPin(String(b.pin ?? ""), Date.now());
          afterAction(s);
          return json(r, r.ok ? 200 : 401);
        }),
      },

      "/api/s/:id/settings": {
        POST: api("user", async (s, req) => {
          const b: any = await req.json();
          if (b.shareLocation === "always" || b.shareLocation === "alert") s.user.shareLocation = b.shareLocation;
          if (b.timers) s.setTimers(b.timers);
          if (b.demoAnswerMode === "canned" || b.demoAnswerMode === "live") s.demoAnswerMode = b.demoAnswerMode;
          afterAction(s);
          return json({ ok: true, timers: s.timers });
        }),
      },

      "/api/s/:id/end": {
        POST: api("user", (s) => {
          endSession(s, "ended by user");
          return json({ ok: true, deleted: true });
        }),
      },

      "/api/s/:id/join": {
        POST: api("buddy", async (s, req) => {
          const b: any = await req.json();
          const buddy = s.buddyJoin(String(b.name ?? ""), Date.now());
          afterAction(s);
          return json({ buddyId: buddy.id, name: buddy.name });
        }),
      },

      "/api/s/:id/buddy/:action": {
        POST: api("buddy", async (s, req) => {
          const b: any = await req.json();
          const buddy = s.buddies.get(String(b.buddyId));
          if (!buddy) return json({ error: "unknown buddy" }, 404);
          const now = Date.now();
          const action = req.params.action;
          if (action === "ack") s.ack(buddy.id, now);
          else if (action === "escalate") s.escalate(buddy.name, now);
          else if (action === "safe") s.resolve(buddy.name, "buddy is with them in person", now);
          else return json({ error: "unknown action" }, 400);
          afterAction(s);
          return json({ ok: true });
        }),
      },

      "/api/s/:id/demo/:action": {
        POST: api("user", async (s, req) => {
          const b: any = await req.json().catch(() => ({}));
          const now = Date.now();
          const action = req.params.action!;
          switch (action) {
            case "fall":
              s.motion(now);
              s.fall(now, 3.4, true);
              break;
            case "slurred":
            case "coherent": {
              let c = s.pendingCheckin ?? s.askCheckin("manual", now);
              if (!c || c.status !== "pending") return json({ error: "a check-in is already being scored" }, 409);
              afterAction(s);
              const delay = Math.max(0, Math.min(15_000, Number(b.delayMs ?? 2500)));
              const id = c.id;
              const live = s.demoAnswerMode === "live";
              const run = async () => {
                if (live) {
                  const data = new Uint8Array(await Bun.file(`${PUBLIC_DIR}demo-audio/${action}.wav`).arrayBuffer());
                  await s.answerCheckin(id, { audio: { data, mime: "audio/wav" }, source: `demo audio: ${action}` });
                } else {
                  await s.answerCheckin(id, { text: CANNED[action], source: `demo script: ${action}`, canned: true });
                }
                if (s.status === "active") afterAction(s);
              };
              if (b.wait) {
                await Bun.sleep(delay);
                await run();
              } else setTimeout(() => run().catch(console.error), delay);
              return json({ ok: true, checkinId: id, mode: s.demoAnswerMode });
            }
            case "miss": {
              const c = s.pendingCheckin ?? s.askCheckin("manual", now);
              if (c && c.status === "pending") c.deadline = Math.min(c.deadline, now + Math.max(0, Number(b.afterMs ?? 3000)));
              break;
            }
            case "checkin":
              s.askCheckin("manual", now);
              break;
            case "walk":
              s.startWalk(now, Number(b.distM) || 350, Number(b.durationMs ?? 8000));
              break;
            case "back":
              s.stopWalk(now);
              break;
            case "offline":
              s.setOffline(true, now);
              break;
            case "online":
              s.setOffline(false, now);
              break;
            case "escalate":
              s.escalate("demo panel", now);
              break;
            case "ack": {
              const first = [...s.buddies.values()][0] ?? s.buddyJoin("Demo buddy", now);
              s.ack(first.id, now);
              break;
            }
            case "resolve":
              s.resolve("demo panel", "manual reset of the alert", now);
              break;
            case "scene":
              s.newScene(now);
              break;
            case "reset":
              s.reset(now);
              break;
            default:
              return json({ error: `unknown demo action ${action}` }, 400);
          }
          afterAction(s);
          return json({ ok: true });
        }),
      },
    },

    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const s = getSession(url.searchParams.get("s") ?? "");
        if (!s) return new Response("session not found", { status: 404 });
        const role = roleOf(req, s);
        if (!role) return new Response("forbidden", { status: 403 });
        const asDemo = url.searchParams.get("as") === "demo" && role === "user";
        const buddyId = url.searchParams.get("b") ?? undefined;
        if (srv.upgrade(req, { data: { sid: s.id, role: asDemo ? "demo" : role, buddyId } })) return undefined;
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
        const s = getSession(ws.data.sid);
        if (!s) return ws.close();
        const topic = ws.data.role === "buddy" ? "buddy" : "user";
        ws.subscribe(`${s.id}:${topic}`);
        if (ws.data.role === "user") {
          s.userSockets++;
          s.heartbeat(Date.now());
        }
        const b = ws.data.buddyId ? s.buddies.get(ws.data.buddyId) : undefined;
        if (ws.data.role === "buddy" && b) b.sockets++;
        ws.send(JSON.stringify({ t: "view", view: s.view(ws.data.role === "buddy" ? "buddy" : "user", Date.now()) }));
        if (b) publishViews(s);
      },
      message() {
        // Clients talk to us over HTTP; the socket is push-only.
      },
      close(ws: ServerWebSocket<WsData>) {
        const s = getSession(ws.data.sid);
        if (!s) return;
        if (ws.data.role === "user") s.userSockets = Math.max(0, s.userSockets - 1);
        const b = ws.data.buddyId ? s.buddies.get(ws.data.buddyId) : undefined;
        if (b) {
          b.sockets = Math.max(0, b.sockets - 1);
          publishViews(s);
        }
      },
    },
  });

  const loop = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (now - s.startedAt > SESSION_TTL_MS) endSession(s, "expired after 12 h");
      else s.tick(now);
    }
  }, opts.tickMs ?? 250);

  return {
    server,
    sessions,
    url: `http://localhost:${server.port}`,
    stop() {
      clearInterval(loop);
      server.stop(true);
    },
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function baseUrl(req: Request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
