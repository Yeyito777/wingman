import { expect, test } from "bun:test";
import { ApiError, WingmanClient, normalizeBaseUrl, wsUrl } from "../src/api/client";

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { f, calls };
}

test("base URL normalisation and WS URL", () => {
  expect(normalizeBaseUrl("wingman.example/")).toBe("https://wingman.example");
  expect(wsUrl("http://localhost:3100", { code: "K7Q2XM", memberId: "m_1", key: "a b" })).toBe("ws://localhost:3100/ws?g=K7Q2XM&m=m_1&k=a%20b");
});

test("member endpoints use the code, member id and Bearer key", async () => {
  const { f, calls } = fakeFetch(() => ({ body: { ok: true } }));
  const c = new WingmanClient("https://h", { code: "K7Q2XM", memberId: "m_me", key: "secret" }, { fetch: f });
  await c.signals({ heartbeat: true });
  await c.ack("m_maya");
  await c.resolve("m_me", "1234");
  await c.answerCheckin("c_1", { audio: "AAA", mime: "audio/m4a", durationMs: 100 });
  expect(calls.map((x) => x.url)).toEqual([
    "https://h/api/groups/K7Q2XM/members/m_me/signals",
    "https://h/api/groups/K7Q2XM/members/m_maya/ack",
    "https://h/api/groups/K7Q2XM/members/m_me/resolve",
    "https://h/api/groups/K7Q2XM/members/m_me/checkins/c_1/answer",
  ]);
  expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ pin: "1234" });
});

test("errors carry status and body (wrong PIN)", async () => {
  const { f } = fakeFetch(() => ({ status: 401, body: { ok: false, attemptsLeft: 2 } }));
  const c = new WingmanClient("https://h", { code: "K7Q2XM", memberId: "m_me", key: "k" }, { fetch: f });
  const e = (await c.resolve("m_me", "0000").catch((x) => x)) as ApiError;
  expect(e).toBeInstanceOf(ApiError);
  expect(e.status).toBe(401);
  expect(e.body).toEqual({ ok: false, attemptsLeft: 2 });
});

test("network failure is a friendly ApiError", async () => {
  const c = new WingmanClient("https://h", null, { fetch: async () => { throw new TypeError("fetch failed"); } });
  const e = (await c.health().catch((x) => x)) as ApiError;
  expect(e.status).toBe(0);
  expect(e.message).toBe("Can't reach the Wingman server.");
});
