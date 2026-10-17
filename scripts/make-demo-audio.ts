// Generates the canned check-in replies used by the demo panel's "live Gemini" option, via Gemini TTS.
// Run once: secrets run --allow GEMINI_API_KEY -- bun scripts/make-demo-audio.ts
// Output: public/demo-audio/{slurred,coherent}.wav (16 kHz mono PCM). These are AI-generated voices.

import { encodeWav } from "../src/shared/wav.ts";

const CLIPS = {
  slurred: {
    voice: "Puck",
    say: "(slurring, very drunk, mumbling) Uhh... m'fine... I'm at the... the place with the... lights. I dunno... where's Sam...",
  },
  coherent: {
    voice: "Puck",
    say: "I'm at the Rex on Queen Street with Sam and Priya, we're heading home in about an hour.",
  },
};

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY not set");
const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";

const only = process.argv[2];
for (const [name, clip] of Object.entries(CLIPS)) {
  if (only && name !== only) continue;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: clip.say }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: clip.voice } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const part = json.candidates[0].content.parts.find((p: any) => p.inlineData);
  const mime: string = part.inlineData.mimeType; // e.g. audio/L16;codec=pcm;rate=24000
  let rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  let pcm = Buffer.from(part.inlineData.data, "base64");
  if (pcm.toString("ascii", 0, 4) === "RIFF") {
    // Already a WAV container: read the sample rate and locate the PCM data chunk.
    rate = pcm.readUInt32LE(24);
    let o = 12;
    while (o < pcm.length - 8 && pcm.toString("ascii", o, o + 4) !== "data") o += 8 + pcm.readUInt32LE(o + 4);
    pcm = pcm.subarray(o + 8, o + 8 + pcm.readUInt32LE(o + 4));
  }
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const wav = encodeWav(samples, rate, 16000);
  await Bun.write(`public/demo-audio/${name}.wav`, wav);
  console.log(`${name}: ${mime}, ${(samples.length / rate).toFixed(1)} s -> public/demo-audio/${name}.wav (${wav.byteLength} bytes)`);
}
