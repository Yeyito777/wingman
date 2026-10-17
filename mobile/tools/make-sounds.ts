/// <reference types="bun" />
// Generates the app's sounds (siren, friend alarm, chime) as 16-bit mono WAV. Run: bun tools/make-sounds.ts
const RATE = 22050;

function wav(samples: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
  return new Uint8Array(buf);
}

function render(seconds: number, f: (t: number) => number) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = f(i / RATE);
  return out;
}

// Wailing siren (bystander mode): sweep 650 -> 1450 Hz and back every 1.2 s, square-ish for loudness. Loops seamlessly.
let phase = 0;
const siren = render(2.4, (t) => {
  const p = (t % 1.2) / 1.2;
  const freq = 650 + 800 * (p < 0.5 ? p * 2 : 2 - p * 2);
  phase += (2 * Math.PI * freq) / RATE;
  return 0.9 * Math.tanh(3 * Math.sin(phase));
});

// Friend alarm: urgent two-tone triple beep, then a pause. Loops.
const alarm = render(1.6, (t) => {
  const slot = Math.floor(t / 0.16);
  if (slot > 5 || (t % 0.16) > 0.12) return 0;
  const f = slot % 2 ? 1320 : 990;
  const env = Math.min(1, (t % 0.16) * 200) * Math.min(1, (0.12 - (t % 0.16)) * 200);
  return 0.85 * env * Math.tanh(2.5 * Math.sin(2 * Math.PI * f * t));
});

// Soft two-note chime (check-in / resolved).
const chime = render(0.9, (t) => {
  const note = (f: number, s: number) => (t < s ? 0 : Math.sin(2 * Math.PI * f * (t - s)) * Math.exp(-(t - s) * 5));
  return 0.5 * (note(880, 0) + note(1318.5, 0.14));
});

const dir = new URL("../assets/sounds/", import.meta.url).pathname;
await Bun.write(dir + "siren.wav", wav(siren));
await Bun.write(dir + "alarm.wav", wav(alarm));
await Bun.write(dir + "chime.wav", wav(chime));
console.log("wrote siren.wav, alarm.wav, chime.wav");
