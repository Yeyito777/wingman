// Generates the demo video's narration lines with Gemini TTS (one WAV per line, 24 kHz mono).
//   secrets run --allow GEMINI_API_KEY -- bun scripts/demo-video/narration.ts OUT_DIR
// Retries on rate limits; lines that already exist are skipped, so it can simply be rerun.

import { existsSync, mkdirSync } from "node:fs";

export const LINES: Record<string, string> = {
  n0: "Every safety app assumes you can press the button. But if your drink is spiked, or you've had far too much, you can't. This is Wingman.",
  n1: "Friends going out join tonight's group with a six-letter code. Everyone is everyone's wingman: each phone guards its owner, and every other member.",
  n2: "Every so often, or when something looks off, Wingman checks in, out loud: where are you, and who are you with? A clear answer means you're fine.",
  n3: "Later, I drift three hundred and fifty meters away from my friends, and my phone detects a fall.",
  n4: "So Wingman asks again. This is all I manage to say.",
  n5: "Gemini listens to the actual audio and hears slurred, confused speech. A deterministic risk engine combines it with the fall and the distance, and every other phone in the group alarms, with my location and the reasons.",
  n6: "If nobody responds, my own phone turns into a sign for bystanders: this person may need help, with my medical info and a button to call 911. Then my emergency contact gets a text.",
  n7: "Sam taps I'm on my way, so the whole group sees who's coming. Cancelling the alarm needs my PIN, so a confused person can't dismiss it by accident.",
  n8: "No accounts, no database, and everything is deleted when the night ends. The moment you need help most is the moment you can't ask for it. With Wingman, your friends' phones ask for you.",
};

const out = process.argv[2];
if (!out) throw new Error("usage: narration.ts OUT_DIR");
mkdirSync(out, { recursive: true });
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY not set");
const models = (process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts,gemini-2.5-flash-preview-tts").split(",");
const voice = process.env.VOICE || "Kore";
const style = "";

function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

for (const [name, say] of Object.entries(LINES)) {
  const file = `${out}/${name}.wav`;
  if (existsSync(file)) continue;
  let done = false;
  for (let attempt = 0; attempt < 8 && !done; attempt++) {
    const model = models[attempt % models.length]!;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: style + say }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    if (!res.ok) {
      console.log(`${name}: ${model} HTTP ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, " ")}`);
      await Bun.sleep(res.status === 429 ? 20_000 : 3000);
      continue;
    }
    const json: any = await res.json();
    const part = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!part) { console.log(`${name}: no audio part`); continue; }
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
    const pcm = Buffer.from(part.inlineData.data, "base64");
    await Bun.write(file, pcm.toString("ascii", 0, 4) === "RIFF" ? pcm : wav(pcm, rate));
    console.log(`${name}: ${model} ${(pcm.length / 2 / rate).toFixed(1)} s`);
    done = true;
    await Bun.sleep(Number(process.env.GAP_MS ?? 12_000));
  }
  if (!done) console.log(`${name}: FAILED`);
}
