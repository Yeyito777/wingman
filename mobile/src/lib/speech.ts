// Speaking the check-in question all the way through before the mic opens.
//
// iOS can end an utterance early (the audio session deactivated or interrupted, a route change) and still report it as
// "done". If we trusted that, the question was cut off mid-sentence and recording started on top of it. So: speak in
// playback mode with an active session, treat a "done" that came far too early as a cut and say it once more, and wait
// for the synthesizer to really go quiet before returning.

/** Typical words per minute at the app's speech rate (~0.95× normal) is ~160. */
const MS_PER_WORD = 380;

export type SpeakOutcome = "done" | "cut" | "error";
type Once = "done" | "stopped" | "error";

/** Roughly how long the synthesizer needs for `text`. */
export function expectedSpeechMs(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length * MS_PER_WORD;
}

/** A "done" sooner than half the expected time means iOS tore the utterance down. */
export function finishedTooSoon(text: string, elapsedMs: number) {
  return elapsedMs < expectedSpeechMs(text) * 0.5;
}

export interface SpeechEngine {
  speak(text: string, cb: { onDone(): void; onStopped(): void; onError(): void }): void;
  isSpeaking(): Promise<boolean>;
  prepare(): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

function speakOnce(e: SpeechEngine, text: string): Promise<Once> {
  return new Promise((resolve) => {
    let settled = false;
    const fin = (r: Once) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(r);
    };
    // Lost events must not leave the sheet stuck on "Listen…".
    const watchdog = setTimeout(() => fin("done"), expectedSpeechMs(text) * 2.5 + 4000);
    try {
      e.speak(text, { onDone: () => fin("done"), onStopped: () => fin("stopped"), onError: () => fin("error") });
    } catch {
      fin("error");
    }
  });
}

/** Speak `text` to the end (one retry if it was cut short). `alive()` false = the sheet closed; stop quietly. */
export async function speakFully(text: string, alive: () => boolean, e: SpeechEngine): Promise<SpeakOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await e.prepare();
    if (!alive()) return "cut";
    const t0 = e.now();
    const r = await speakOnce(e, text);
    if (!alive()) return "cut";
    if (r === "error") return "error";
    if (r === "done" && !finishedTooSoon(text, e.now() - t0)) {
      // "done" arrives a moment before the last audio leaves the speaker: let it drain.
      await e.sleep(250);
      for (let i = 0; i < 20 && (await e.isSpeaking()); i++) await e.sleep(100);
      return "done";
    }
  }
  return "cut";
}
