// AI check-in scoring: was the reply coherent, or does it sound slurred / confused / impaired?
// Engines: Gemini (audio straight into the model) -> OpenAI (transcribe + small model) -> deterministic mock.
// Every call degrades gracefully: on error or timeout we fall through to the next engine, ending at the mock.

import type { CheckinResult } from "../shared/types.ts";

export interface ScoreRequest {
  question: string;
  name: string;
  audio?: { data: Uint8Array; mime: string };
  text?: string;
}

type Engine = CheckinResult["engine"];
type Raw = Omit<CheckinResult, "engine" | "latencyMs" | "fallbackFrom">;

const SYSTEM = `You are the check-in analyst inside Wingman, a night-out safety app.
The person was asked a short check-in question by their phone and this is their reply.
Decide whether they sound safe and oriented, or impaired (heavily intoxicated, possibly spiked/drugged, concussed, confused, in distress).
Consider: slurred or mumbled speech, very slow or halting speech, trailing off, inability to say where they are or who they are with,
confusion or disorientation, nonsensical or off-topic answers, distress or calls for help.
Someone a bit tipsy who is clear and oriented is OK; avoid false alarms.
impairment scale: 0.0 clear and oriented; 0.3 tipsy but fine; 0.6 noticeably impaired or confused; 0.9 severely impaired, can barely communicate.
responded=false only if there is no intelligible attempt to answer (silence, noise only).
coherent=true if the answer is an understandable, on-topic reply from an oriented person.
reason: one short plain-English phrase (max 12 words) a worried friend would understand, e.g. "slurred speech, couldn't say where they are".
signs: short lowercase tags such as "slurred speech", "disoriented", "no location", "distress".
transcript: what they said, verbatim as best you can.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    responded: { type: "BOOLEAN" },
    coherent: { type: "BOOLEAN" },
    impairment: { type: "NUMBER" },
    signs: { type: "ARRAY", items: { type: "STRING" } },
    reason: { type: "STRING" },
  },
  required: ["transcript", "responded", "coherent", "impairment", "signs", "reason"],
};

function userText(r: ScoreRequest) {
  const head = `Person's first name: ${r.name}\nCheck-in question they were asked: "${r.question}"\n`;
  if (r.audio) return head + "Their spoken reply is attached as audio. Listen to how they speak, not just the words.";
  return head + `Their reply (typed or transcribed text only, so you cannot hear slurring; judge the content):\n"""${r.text ?? ""}"""`;
}

export function availableEngines(env = process.env): Engine[] {
  const forced = env.SCORER?.trim().toLowerCase();
  const all: Engine[] = [];
  if (env.GEMINI_API_KEY) all.push("gemini");
  if (env.OPENAI_API_KEY) all.push("openai");
  all.push("mock");
  if (forced === "gemini" || forced === "openai" || forced === "mock") {
    return all.includes(forced) ? [forced, ...all.filter((e) => e !== forced)] : all;
  }
  return all;
}

const cache = new Map<string, CheckinResult>();
const CACHE_MAX = 200;

/** Score a reply with the best available engine, falling back on failure. Results are cached by content. */
export async function scoreCheckin(req: ScoreRequest, engines = availableEngines()): Promise<CheckinResult> {
  const key = await cacheKey(req, engines[0]!);
  const hit = cache.get(key);
  if (hit) return { ...hit, latencyMs: 0 };
  let failed: string | undefined;
  for (const engine of engines) {
    const t0 = performance.now();
    try {
      const raw = await withTimeout(run(engine, req), engine === "mock" ? 1000 : 20_000);
      const result: CheckinResult = { ...normalize(raw), engine, latencyMs: Math.round(performance.now() - t0) };
      if (failed) result.fallbackFrom = failed;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    } catch (err) {
      failed = `${engine}: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
      console.warn(`[scorer] ${failed}`);
    }
  }
  throw new Error("unreachable: mock scorer failed");
}

function run(engine: Engine, req: ScoreRequest): Promise<Raw> {
  if (engine === "gemini") return gemini(req);
  if (engine === "openai") return openai(req);
  return Promise.resolve(mockScore(req));
}

// ---------- Gemini ----------

// Lite first: ~2 s for a voice reply versus ~4-7 s for full Flash, which matters while someone waits.
const GEMINI_DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash"];
let geminiWorking: string | null = null;

export function geminiModels(env = process.env): string[] {
  const first = env.GEMINI_MODEL?.trim() || geminiWorking;
  return [...new Set([...(first ? [first] : []), ...GEMINI_DEFAULT_MODELS])];
}

async function gemini(req: ScoreRequest): Promise<Raw> {
  const key = process.env.GEMINI_API_KEY!;
  const models = geminiModels();
  const parts: any[] = [{ text: userText(req) }];
  if (req.audio) parts.push({ inline_data: { mime_type: geminiMime(req.audio.mime), data: Buffer.from(req.audio.data).toString("base64") } });
  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
  };
  let lastErr = "";
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (res.status === 404 || res.status === 429 || res.status >= 500) {
      // Unknown model, rate limit, or overloaded: try the next model before giving up on Gemini.
      lastErr = `${model}: HTTP ${res.status}`;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    geminiWorking = model;
    return { ...JSON.parse(text), model };
  }
  throw new Error(lastErr);
}

/** iOS records AAC in an MPEG-4 container (.m4a) and labels it a few different ways; Gemini wants audio/mp4. */
export function geminiMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  if (m === "audio/m4a" || m === "audio/x-m4a" || m === "audio/mp4a-latm" || m === "audio/mp4" || m === "video/mp4") return "audio/mp4";
  if (m === "audio/x-wav" || m === "audio/wave" || m === "audio/vnd.wave") return "audio/wav";
  if (m === "audio/mp3") return "audio/mpeg";
  return m || "audio/wav";
}

// ---------- OpenAI ----------

async function openai(req: ScoreRequest): Promise<Raw> {
  const key = process.env.OPENAI_API_KEY!;
  let text = req.text ?? "";
  if (req.audio) {
    const form = new FormData();
    const gm = geminiMime(req.audio.mime);
    const ext = gm.includes("wav") ? "wav" : gm.includes("mp4") ? "m4a" : gm.includes("aac") ? "aac" : gm.includes("mpeg") ? "mp3" : gm.includes("ogg") ? "ogg" : "webm";
    form.append("file", new Blob([req.audio.data as BlobPart], { type: req.audio.mime }), `reply.${ext}`);
    form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!tr.ok) throw new Error(`transcribe HTTP ${tr.status} ${(await tr.text()).slice(0, 200)}`);
    text = ((await tr.json()) as any).text ?? "";
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM + "\nReply with a JSON object with keys: transcript, responded, coherent, impairment, signs, reason." },
        { role: "user", content: userText({ ...req, audio: undefined, text }) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`chat HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  const out = JSON.parse(json.choices[0].message.content);
  return { ...out, transcript: text || out.transcript || "", model };
}

// ---------- Deterministic mock ----------

/** Text heuristics, so the app (and the stage demo) works with no keys and no network. */
export function mockScore(req: ScoreRequest): Raw {
  if (req.audio && !req.text) {
    // Can't hear audio without a model: trust that a non-trivial recording is an answer.
    // ~0.75 s of 16 kHz PCM, or ~1.5 s of compressed (AAC/Opus) audio.
    const responded = req.audio.data.byteLength > (geminiMime(req.audio.mime) === "audio/wav" ? 24_000 : 6_000);
    return {
      model: "heuristic",
      transcript: responded ? "(voice reply received; add GEMINI_API_KEY to analyse speech)" : "",
      responded,
      coherent: responded,
      impairment: responded ? 0.2 : 1,
      signs: responded ? [] : ["no answer"],
      reason: responded ? "answered (offline mode can't analyse audio)" : "no audible answer",
    };
  }
  const t = (req.text ?? "").trim();
  const words = t.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) {
    return { model: "heuristic", transcript: t, responded: false, coherent: false, impairment: 1, signs: ["no answer"], reason: "no answer" };
  }
  const signs: string[] = [];
  const fillers = words.filter((w) => /^(u+h+|u+m+|e+r+m*|hmm+|wha+|huh)$/.test(w)).length;
  const stretched = (t.match(/([a-z])\1{2,}/gi) ?? []).length;
  const trailing = (t.match(/\.\.\.|…/g) ?? []).length;
  const slurred = /\b(dunno|m'fine|y'know|wi'|whaaa|shhh|s'okay|'m fine|nn+o+)\b/i.test(t) || stretched > 0;
  const confused = /\b(don'?t know|dunno|not sure|where am i|can'?t remember|what\??$|who are you)\b/i.test(t);
  const oriented = /\b(at|in|with|home|bar|club|party|uber|taxi|friend|friends|walking|going)\b/i.test(t);
  if (slurred) signs.push("slurred speech");
  if (fillers + trailing >= 2) signs.push("halting speech");
  if (confused) signs.push("disoriented");
  if (!oriented) signs.push("no location");
  let imp = 0.1 + 0.25 * (slurred ? 1 : 0) + 0.08 * Math.min(4, fillers + trailing) + (confused ? 0.25 : 0) + (oriented ? 0 : 0.2);
  imp = Math.round(Math.min(0.95, imp) * 100) / 100;
  const coherent = imp < 0.5;
  const reason = coherent
    ? "clear answer, knows where they are"
    : [slurred ? "slurred speech" : fillers + trailing >= 2 ? "halting speech" : "", confused || !oriented ? "couldn't say where they are" : ""]
        .filter(Boolean)
        .join(", ") || "confused answer";
  return { model: "heuristic", transcript: t, responded: true, coherent, impairment: imp, signs, reason };
}

function normalize(r: any): Raw {
  const imp = Number(r?.impairment);
  return {
    model: r?.model,
    transcript: String(r?.transcript ?? ""),
    responded: Boolean(r?.responded),
    coherent: Boolean(r?.coherent),
    impairment: Number.isFinite(imp) ? Math.max(0, Math.min(1, imp)) : 0.5,
    signs: Array.isArray(r?.signs) ? r.signs.map(String).slice(0, 6) : [],
    reason: String(r?.reason ?? "").slice(0, 140),
  };
}

async function cacheKey(req: ScoreRequest, engine: Engine) {
  const h = new Bun.CryptoHasher("sha256");
  h.update(`${engine}|${req.question}|${req.name}|${req.text ?? ""}|`);
  if (req.audio) h.update(req.audio.data);
  return h.digest("hex");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}
