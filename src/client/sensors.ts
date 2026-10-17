// Passive signals from the phone, all in the browser: motion (fall detection), location, touches, battery,
// plus the voice recorder used for AI check-ins.

import { encodeWav } from "../shared/wav.ts";
import { audio } from "./common.ts";

const G = 9.81;

export interface FallDetectorOptions {
  /** impact threshold in g */
  impactG?: number;
  /** stillness after the impact needed to confirm a fall */
  confirmMs: () => number;
  onFall: (peakG: number) => void;
  onMove: () => void;
}

/**
 * Impact followed by stillness = likely fall / collapse.
 * Uses accelerationIncludingGravity, which every phone reports (iOS and Android).
 */
export function startFallDetector(o: FallDetectorOptions) {
  const impactG = o.impactG ?? 2.6;
  let impactAt = 0;
  let peak = 0;
  let windowStart = 0;
  let lastMoveSent = 0;
  const recent: number[] = [];
  let samples = 0;

  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    samples++;
    const g = Math.sqrt(a.x! ** 2 + a.y! ** 2 + a.z! ** 2) / G;
    const now = Date.now();
    recent.push(g);
    if (recent.length > 30) recent.shift();

    // Ordinary movement keeps the "last moved" signal fresh (throttled).
    const dev = Math.abs(g - 1);
    if (dev > 0.18 && now - lastMoveSent > 5000) {
      lastMoveSent = now;
      o.onMove();
    }

    if (g >= impactG) {
      if (!impactAt || now - impactAt > 1500) peak = 0;
      impactAt = now;
      windowStart = now + 700; // let the bounce settle before judging stillness
      peak = Math.max(peak, g);
      return;
    }
    if (impactAt && now >= windowStart) {
      // After the impact: any real movement cancels; sustained stillness confirms.
      if (dev > 0.25) {
        impactAt = 0;
        return;
      }
      if (now - windowStart >= o.confirmMs()) {
        const p = peak;
        impactAt = 0;
        o.onFall(p);
      }
    }
  };
  window.addEventListener("devicemotion", onMotion);
  return {
    stop: () => window.removeEventListener("devicemotion", onMotion),
    get samples() {
      return samples;
    },
  };
}

/** iOS 13+ needs an explicit permission request from a user gesture. */
export async function requestMotionPermission(): Promise<string> {
  const DME = (window as any).DeviceMotionEvent;
  if (!DME) return "unsupported";
  if (typeof DME.requestPermission === "function") {
    try {
      return (await DME.requestPermission()) === "granted" ? "on" : "denied";
    } catch {
      return "denied";
    }
  }
  return "on";
}

export function watchLocation(onFix: (f: { lat: number; lng: number; accuracy: number }) => void, onState: (s: string) => void) {
  if (!("geolocation" in navigator)) {
    onState("unsupported");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => {
      onState("on");
      onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
    },
    (err) => onState(err.code === 1 ? "denied" : "searching"),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

let micStream: MediaStream | null = null;

export async function requestMic(): Promise<string> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // Release right away; we re-open the mic only during a check-in (no always-on mic indicator).
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    return "on";
  } catch {
    return "denied";
  }
}

export interface Recording {
  stop(): void;
  cancel(): void;
  done: Promise<{ blob: Blob; mime: string; spoke: boolean } | null>;
}

/**
 * Record a short reply. Stops after `maxMs`, or ~1.4 s of silence once speech was heard.
 * Reports a 0..1 level for the UI. Output is converted to 16 kHz WAV, which every AI engine accepts.
 */
export function recordReply(opts: { maxMs: number; onLevel: (l: number) => void }): Recording {
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let cancelled = false;
  let stopFn = () => {};
  const done = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    const c = audio();
    const src = c.createMediaStreamSource(stream);
    const an = c.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const started = Date.now();
    let spoke = false;
    let lastVoice = 0;
    const finished = new Promise<void>((r) => (rec!.onstop = () => r()));
    rec.start(250);
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 12);
      opts.onLevel(level);
      const now = Date.now();
      if (rms > 0.03) {
        spoke = true;
        lastVoice = now;
      }
      if (now - started > opts.maxMs || (spoke && now - lastVoice > 1400 && now - started > 1500)) stopFn();
    }, 60);
    stopFn = () => {
      if (rec && rec.state !== "inactive") rec.stop();
    };
    await finished;
    clearInterval(timer);
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    opts.onLevel(0);
    if (cancelled) return null;
    const raw = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
    try {
      const decoded = await c.decodeAudioData(await raw.arrayBuffer());
      const wav = encodeWav(decoded.getChannelData(0), decoded.sampleRate, 16000);
      return { blob: new Blob([wav as BlobPart], { type: "audio/wav" }), mime: "audio/wav", spoke };
    } catch {
      return { blob: raw, mime: raw.type, spoke };
    }
  })();
  return {
    stop: () => stopFn(),
    cancel: () => {
      cancelled = true;
      stopFn();
    },
    done,
  };
}

/** Keep the screen awake during the night out (Screen Wake Lock API, where supported). */
export async function keepAwake(): Promise<string> {
  const wl = (navigator as any).wakeLock;
  if (!wl) return "unsupported";
  let lock: any = null;
  const acquire = async () => {
    try {
      lock = await wl.request("screen");
    } catch {}
  };
  await acquire();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!lock || lock.released)) acquire();
  });
  return lock ? "on" : "denied";
}

export async function batteryLevel(): Promise<number | null> {
  try {
    const b = await (navigator as any).getBattery?.();
    return b ? Math.round(b.level * 100) : null;
  } catch {
    return null;
  }
}
