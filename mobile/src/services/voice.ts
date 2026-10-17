// expo-speech wired into the speak-it-all-the-way-through logic in lib/speech.ts.

import * as Speech from "expo-speech";
import { speakFully as speakFullyWith, type SpeakOutcome, type SpeechEngine } from "../lib/speech";
import { prepareForSpeech } from "./alarm";

/** expo-speech scales iOS's default rate: 1 = normal. Slightly slower than normal, for a noisy room. */
export const SPEECH_RATE = 0.95;

const expoEngine: SpeechEngine = {
  speak: (text, cb) => Speech.speak(text, { rate: SPEECH_RATE, useApplicationAudioSession: true, onDone: cb.onDone, onStopped: cb.onStopped, onError: cb.onError }),
  isSpeaking: () => Speech.isSpeakingAsync().catch(() => false),
  prepare: prepareForSpeech,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export const speakFully = (text: string, alive: () => boolean): Promise<SpeakOutcome> => speakFullyWith(text, alive, expoEngine);
