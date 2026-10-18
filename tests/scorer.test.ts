// Gemini hedging, with fetch stubbed: a request that hangs must not cost the answer, and losers get aborted.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { geminiModels, scoreCheckin } from "../src/server/scorer.ts";

const realFetch = globalThis.fetch;
const OK = { transcript: "at the bar with Sam", responded: true, coherent: true, impairment: 0.1, signs: [], reason: "clear answer" };
let calls: { model: string; signal: AbortSignal }[];
let reply: (model: string, n: number) => Promise<Response> | "hang";

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test";
  process.env.GEMINI_HEDGE_MS = "50";
  calls = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    const model = /models\/([^:]+):/.exec(url)![1]!;
    const signal = init.signal!;
    calls.push({ model, signal });
    const r = reply(model, calls.length);
    if (r !== "hang") return r;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_HEDGE_MS;
});

const answer = (o: unknown) => Promise.resolve(Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }));
const req = (text: string) => ({ question: "where are you?", name: "Maya", text });

test("a hung Gemini request is hedged with the next model, and the hung one is aborted", async () => {
  reply = (_m, n) => (n === 1 ? "hang" : answer(OK));
  const r = await scoreCheckin(req("hedge 1"), ["gemini", "mock"]);
  expect(r.engine).toBe("gemini");
  expect(r.fallbackFrom).toBeUndefined();
  expect(r.model).toBe(geminiModels()[1]!);
  expect(r.latencyMs).toBeLessThan(1000);
  expect(calls.length).toBe(2);
  expect(calls[0]!.signal.aborted).toBe(true);
});

test("an HTTP error moves to the next model at once; a 404'd model is skipped from then on", async () => {
  const first = geminiModels()[0]!;
  reply = (m) => (m === first ? Promise.resolve(new Response("gone", { status: 404 })) : answer(OK));
  const r = await scoreCheckin(req("hedge 2"), ["gemini", "mock"]);
  expect(r.engine).toBe("gemini");
  expect(calls.map((c) => c.model)).toEqual([first, geminiModels()[0]!]);
  expect(geminiModels()).not.toContain(first);
});

test("if every model fails, Gemini gives up and the next engine answers", async () => {
  reply = () => Promise.resolve(new Response("busy", { status: 429 }));
  const r = await scoreCheckin(req("hedge 3"), ["gemini", "mock"]);
  expect(r.engine).toBe("mock");
  expect(r.fallbackFrom).toContain("HTTP 429");
  expect(calls.length).toBe(geminiModels().length);
});
