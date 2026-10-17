// Sounds, haptics and local notifications. Every call is safe to repeat and safe on web (best effort).

import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

type Sound = "siren" | "alarm" | "chime";
const SOURCES: Record<Sound, number> = {
  siren: require("../../assets/sounds/siren.wav"),
  alarm: require("../../assets/sounds/alarm.wav"),
  chime: require("../../assets/sounds/chime.wav"),
};

/** Length of the check-in chime (assets/sounds/chime.wav). */
const CHIME_MS = 900;

const players: Partial<Record<Sound, AudioPlayer>> = {};
let hapticTimer: ReturnType<typeof setInterval> | null = null;
let modeRecording: boolean | null = null;

/**
 * The app's single audio mode; `recording` only during a check-in answer. Always pass every field: expo-audio resets
 * omitted ones to defaults, and the ring/silent switch must not mute an emergency (or the spoken check-in).
 */
export async function audioMode(recording: boolean) {
  if (modeRecording === recording) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix", allowsRecording: recording });
    modeRecording = recording;
  } catch {}
}

/** Before speaking: playback mode and an active session (another app or a call may have taken it meanwhile). */
export async function prepareForSpeech() {
  modeRecording = null; // re-assert the category even if we think it's set: iOS may have changed it under us
  await audioMode(false);
  await setIsAudioActiveAsync(true).catch(() => {});
}

function player(s: Sound) {
  // keepAudioSessionActive: by default expo-audio deactivates the shared AVAudioSession ~100 ms after a sound ends
  // or pauses, and that kills whatever else is playing through it: it cut the spoken check-in question off right
  // after the 0.9 s chime. The session stays active while the app runs.
  if (!players[s]) players[s] = createAudioPlayer(SOURCES[s], { keepAudioSessionActive: true });
  return players[s]!;
}

export async function play(s: Sound, loop = false) {
  try {
    await audioMode(false);
    const p = player(s);
    p.loop = loop;
    p.volume = 1;
    await p.seekTo(0);
    p.play();
  } catch {}
}

/** The chime, resolving once it has finished, so speech never overlaps (or outlives) it. */
export async function chimeAndWait() {
  await play("chime");
  await new Promise((r) => setTimeout(r, CHIME_MS + 150));
}

export function stop(s: Sound) {
  try {
    players[s]?.pause();
  } catch {}
}

function startHaptics(pattern: "alarm" | "siren") {
  stopHaptics();
  if (Platform.OS === "web") return;
  const fire = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  fire();
  hapticTimer = setInterval(fire, pattern === "siren" ? 700 : 1100);
}

function stopHaptics() {
  if (hapticTimer) clearInterval(hapticTimer);
  hapticTimer = null;
}

/** A friend is in trouble: alarm loop + haptics, and a notification if we're not on screen. */
export function friendAlert(title: string, body: string) {
  play("alarm", true);
  startHaptics("alarm");
  if (AppState.currentState !== "active") notify(title, body);
}

export function stopFriendAlert() {
  stop("alarm");
  stopHaptics();
}

/** Bystander mode on this phone. */
export function startSiren() {
  play("siren", true);
  startHaptics("siren");
}

export function stopSiren() {
  stop("siren");
  stopHaptics();
}

export function stopAll() {
  stop("alarm");
  stop("siren");
  stopHaptics();
}

export function tap(kind: "light" | "success" | "warning" = "light") {
  if (Platform.OS === "web") return;
  if (kind === "light") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

// ---------------------------------------------------------------- notifications

export function configureNotifications() {
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
  });
}

export async function notify(title: string, body: string) {
  if (Platform.OS === "web") return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, interruptionLevel: "timeSensitive" },
      trigger: null,
    });
  } catch {}
}
