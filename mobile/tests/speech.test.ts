import { describe, expect, test } from "bun:test";
import { expectedSpeechMs, speakFully, type SpeechEngine } from "../src/lib/speech";

const Q = "Hey, it's Wingman. Quick check-in: where are you right now, and who are you with?";

/** A fake synthesizer on a virtual clock: each utterance "lasts" the next duration in `runs`, then fires `end`. */
function engine(runs: { ms: number; end: "done" | "stopped" | "error" }[], speakingAfter = 0) {
  let t = 0;
  let spoken = 0;
  let prepared = 0;
  let drain = speakingAfter;
  const e: SpeechEngine = {
    speak: (_text, cb) => {
      const r = runs[spoken++]!;
      t += r.ms;
      queueMicrotask(() => (r.end === "done" ? cb.onDone() : r.end === "stopped" ? cb.onStopped() : cb.onError()));
    },
    isSpeaking: async () => drain-- > 0,
    prepare: async () => void prepared++,
    sleep: async (ms) => void (t += ms),
    now: () => t,
  };
  return { e, spoken: () => spoken, prepared: () => prepared, now: () => t };
}

describe("speaking the check-in question", () => {
  test("a full utterance is done, after the synthesizer goes quiet", async () => {
    const f = engine([{ ms: expectedSpeechMs(Q), end: "done" }], 3);
    expect(await speakFully(Q, () => true, f.e)).toBe("done");
    expect(f.spoken()).toBe(1);
    expect(f.prepared()).toBe(1); // playback mode + active session before speaking
    expect(f.now()).toBeGreaterThanOrEqual(expectedSpeechMs(Q) + 250 + 300); // drained
  });

  test("iOS reporting 'done' right after the chime (session torn down) is a cut: say it again", async () => {
    const f = engine([{ ms: 500, end: "done" }, { ms: expectedSpeechMs(Q), end: "done" }]);
    expect(await speakFully(Q, () => true, f.e)).toBe("done");
    expect(f.spoken()).toBe(2);
    expect(f.prepared()).toBe(2); // the session is re-activated before the retry
  });

  test("an interruption (stopped) is retried once, then given up so the user can tap the mic", async () => {
    const f = engine([{ ms: 800, end: "stopped" }, { ms: 900, end: "stopped" }]);
    expect(await speakFully(Q, () => true, f.e)).toBe("cut");
    expect(f.spoken()).toBe(2);
  });

  test("the user taking over (mic or typing) stops it without a retry", async () => {
    let alive = true;
    const f = engine([{ ms: 800, end: "stopped" }, { ms: 5000, end: "done" }]);
    const speak = f.e.speak;
    f.e.speak = (text, cb) => (speak(text, cb), (alive = false)); // tapped the mic mid-question → Speech.stop()
    expect(await speakFully(Q, () => alive, f.e)).toBe("cut");
    expect(f.spoken()).toBe(1);
  });

  test("an error is reported, not retried", async () => {
    const f = engine([{ ms: 0, end: "error" }]);
    expect(await speakFully(Q, () => true, f.e)).toBe("error");
    expect(f.spoken()).toBe(1);
  });
});
