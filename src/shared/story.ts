// The stage storyline, shared by the stage view (clicker), `bun run rehearse` and the end-to-end test.
// Each step is a demo action about the story subject (the real phone, or a simulated friend).

import type { DemoAction } from "./types.ts";

export interface StoryStep {
  action: DemoAction;
  label: string;
  hint: string;
  /** "friend": the action is performed by a friend of the subject (ack / found) */
  by?: "friend";
}

export const STORY: StoryStep[] = [
  { action: "checkin", label: "Check-in", hint: "Wingman asks out loud: where are you, who are you with?" },
  { action: "walk", label: "Drift away", hint: "350 m away from everyone else" },
  { action: "fall", label: "Fall", hint: "Impact + stillness on the phone" },
  { action: "slurred", label: "Slurred answer", hint: "Gemini hears it → every other phone alerts" },
  { action: "ack", label: "A friend: on my way", hint: "Pauses the ladder (after L2 / L3 have played)", by: "friend" },
  { action: "resolve", label: "Found & OK", hint: "The friend confirms in person (or the PIN on the phone)", by: "friend" },
];
