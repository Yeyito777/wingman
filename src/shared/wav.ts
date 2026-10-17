// Tiny WAV encoder (mono, 16-bit PCM) with linear resampling. Used in the browser to turn
// MediaRecorder output into a format every AI engine accepts, and by the demo-audio script.

export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0]! + (input[i1]! - input[i0]!) * (x - i0);
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate: number, targetRate = rate): Uint8Array {
  const s = resample(samples, rate, targetRate);
  const buf = new ArrayBuffer(44 + s.length * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + s.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, targetRate, true);
  v.setUint32(28, targetRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, s.length * 2, true);
  for (let i = 0; i < s.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i]!)) * 0x7fff, true);
  return new Uint8Array(buf);
}
