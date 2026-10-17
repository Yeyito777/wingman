// Typed client for the Wingman group protocol (shared/protocol.ts). HTTP for actions, a push-only WebSocket for state.
// fetch and WebSocket are injectable so the client is unit-testable without a network.

import type {
  AnswerCheckinRequest,
  AnswerCheckinResponse,
  AskCheckinResponse,
  ClientMsg,
  CreateGroupRequest,
  DemoAction,
  DemoActionRequest,
  GroupPreview,
  JoinResponse,
  MemberSettingsRequest,
  MemberSetup,
  OkResponse,
  PushTokenRequest,
  ResolveResponse,
  ServerMsg,
  SignalBatch,
  SignalResponse,
} from "@shared/protocol";

export interface Credentials {
  code: string;
  memberId: string;
  key: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientDeps {
  fetch?: FetchFn;
  WebSocket?: new (url: string) => WebSocketLike;
  timeoutMs?: number;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  send(data: string): void;
  close(): void;
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export function wsUrl(baseUrl: string, c: Credentials): string {
  const u = normalizeBaseUrl(baseUrl).replace(/^http/i, "ws");
  return `${u}/ws?g=${encodeURIComponent(c.code)}&m=${encodeURIComponent(c.memberId)}&k=${encodeURIComponent(c.key)}`;
}

export class WingmanClient {
  readonly baseUrl: string;
  private fetchFn: FetchFn;
  private WS: ClientDeps["WebSocket"];
  private timeoutMs: number;

  constructor(
    baseUrl: string,
    public creds: Credentials | null = null,
    deps: ClientDeps = {},
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchFn = deps.fetch ?? ((u, i) => fetch(u, i));
    this.WS = deps.WebSocket ?? (globalThis as any).WebSocket;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
  }

  withCreds(c: Credentials | null) {
    return new WingmanClient(this.baseUrl, c, { fetch: this.fetchFn, WebSocket: this.WS, timeoutMs: this.timeoutMs });
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.creds) headers.authorization = `Bearer ${this.creds.key}`;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    let res: Response;
    try {
      res = await this.fetchFn(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl?.signal,
      });
    } catch (e) {
      throw new ApiError(ctrl?.signal.aborted ? "The server took too long to answer." : "Can't reach the Wingman server.", 0, e);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new ApiError((data && typeof data === "object" && data.error) || `HTTP ${res.status}`, res.status, data);
    return data as T;
  }

  private member(id = this.need().memberId) {
    const c = this.need();
    return `/api/groups/${encodeURIComponent(c.code)}/members/${encodeURIComponent(id)}`;
  }

  private need(): Credentials {
    if (!this.creds) throw new ApiError("Not in a group.", 0, null);
    return this.creds;
  }

  health() {
    return this.req<{ ok: boolean }>("GET", "/api/health");
  }

  createGroup(r: CreateGroupRequest) {
    return this.req<JoinResponse>("POST", "/api/groups", r);
  }

  preview(code: string) {
    return this.req<GroupPreview>("GET", `/api/groups/${encodeURIComponent(code)}`);
  }

  join(code: string, setup: MemberSetup) {
    return this.req<JoinResponse>("POST", `/api/groups/${encodeURIComponent(code)}/join`, setup);
  }

  signals(b: SignalBatch) {
    return this.req<SignalResponse>("POST", `${this.member()}/signals`, b);
  }

  askCheckin(memberId?: string, prompt?: string) {
    return this.req<AskCheckinResponse>("POST", `${this.member(memberId)}/checkins`, prompt ? { prompt } : {});
  }

  answerCheckin(checkinId: string, a: AnswerCheckinRequest) {
    return this.req<AnswerCheckinResponse>("POST", `${this.member()}/checkins/${encodeURIComponent(checkinId)}/answer`, a);
  }

  ack(memberId: string) {
    return this.req<OkResponse>("POST", `${this.member(memberId)}/ack`, { kind: "on_my_way" });
  }

  /** Your own alert needs your PIN; a friend's ("found them, they're OK") doesn't. */
  resolve(memberId: string, pin?: string) {
    return this.req<ResolveResponse>("POST", `${this.member(memberId)}/resolve`, pin ? { pin } : {});
  }

  escalate(memberId: string) {
    return this.req<OkResponse>("POST", `${this.member(memberId)}/escalate`, {});
  }

  pushToken(t: PushTokenRequest) {
    return this.req<OkResponse>("POST", `${this.member()}/push-token`, t);
  }

  settings(s: MemberSettingsRequest) {
    return this.req<OkResponse>("POST", `${this.member()}/settings`, s);
  }

  leave() {
    return this.req<OkResponse>("POST", `${this.member()}/leave`, {});
  }

  endNight() {
    return this.req<OkResponse>("POST", `/api/groups/${encodeURIComponent(this.need().code)}/end`, {});
  }

  demo(action: DemoAction, body: DemoActionRequest = {}) {
    return this.req<OkResponse>("POST", `/api/groups/${encodeURIComponent(this.need().code)}/demo/${action}`, body);
  }

  /** Live connection with reconnect + backoff. Returns a handle; `send` is dropped while disconnected. */
  connect(h: { onMessage: (m: ServerMsg) => void; onStatus: (s: "connecting" | "open" | "closed") => void }) {
    const creds = this.need();
    const WS = this.WS;
    if (!WS) throw new Error("WebSocket unavailable");
    let ws: WebSocketLike | null = null;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const open = () => {
      if (closed) return;
      h.onStatus("connecting");
      ws = new WS(wsUrl(this.baseUrl, creds));
      ws.onopen = () => {
        attempt = 0;
        h.onStatus("open");
        ping = setInterval(() => send({ t: "ping" }), 15_000);
      };
      ws.onmessage = (ev) => {
        try {
          h.onMessage(JSON.parse(String(ev.data)) as ServerMsg);
        } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (ping) clearInterval(ping);
        ping = null;
        ws = null;
        if (closed) return;
        h.onStatus("closed");
        retry = setTimeout(open, Math.min(10_000, 500 * 2 ** attempt++));
      };
    };
    const send = (m: ClientMsg) => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
      else return false;
      return true;
    };
    open();
    return {
      send,
      reconnectNow() {
        if (ws || closed) return;
        if (retry) clearTimeout(retry);
        attempt = 0;
        open();
      },
      close() {
        closed = true;
        if (retry) clearTimeout(retry);
        if (ping) clearInterval(ping);
        ws?.close();
        ws = null;
      },
    };
  }
}
