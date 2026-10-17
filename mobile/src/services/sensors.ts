// Passive signals from this phone: location, motion (fall detection), battery, app state, heartbeat.
// Runs while the app is in a group. In a dev build, location keeps flowing in the background (UIBackgroundModes).

import * as Battery from "expo-battery";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import * as TaskManager from "expo-task-manager";
import { AppState, Platform, type AppStateStatus } from "react-native";
import type { SensorReport, SignalBatch } from "@shared/protocol";
import { createFallDetector } from "../lib/fall";
import { getState } from "../state/store";
import { isExpoGo } from "./platform";
import { sendSignals } from "./session";

export const BG_LOCATION_TASK = "wingman-background-location";

// Must be defined at module scope so iOS can wake the JS runtime with location updates.
if (Platform.OS !== "web") {
  try {
    TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
      if (error || !data) return;
      const locs = (data as { locations?: Location.LocationObject[] }).locations ?? [];
      const l = locs[locs.length - 1];
      if (l) sendSignals({ heartbeat: true, fix: fixOf(l) });
    });
  } catch {}
}

function fixOf(l: Location.LocationObject) {
  return { lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy ?? 50, speed: l.coords.speed, heading: l.coords.heading };
}

export const sensors: SensorReport = { motion: "unknown", location: "unknown", mic: "unknown", notifications: "unknown" };

/** Re-send an unchanged fix this often: iOS only reports movement, and the server treats fixes older than 3 min as
 *  stale (they stop anchoring the group). */
const FIX_RESEND_MS = 30_000;

let running = false;
let stops: (() => void)[] = [];
let lastFix: SignalBatch["fix"] | null = null;
let lastSentFix: SignalBatch["fix"] | null = null;
let lastFixSentAt = 0;
let watching = false;
let startingLocation = false;
/** iOS "Precise Location" is off: fixes are only good to a few km. */
export let locationReduced = false;
let moving = false;
let peakG = 1;
let battery: number | undefined;
let charging: boolean | undefined;

/** Called whenever the user touches the app. */
export function interaction() {
  pendingInteraction = true;
}
let pendingInteraction = false;

export async function start() {
  if (running) return;
  running = true;

  // Location (foreground watch; background task where the build allows it). Retried from the heartbeat until it runs,
  // so granting permission after joining (or in Settings) starts it without restarting the app.
  await startLocation();

  // Motion: impact + stillness = fall.
  try {
    if (await Accelerometer.isAvailableAsync()) {
      const det = createFallDetector({ confirmMs: getState().view?.timers.fallConfirmMs ?? 10_000 });
      Accelerometer.setUpdateInterval(50);
      const sub = Accelerometer.addListener(({ x, y, z }) => {
        const t = Date.now();
        const g = Math.sqrt(x * x + y * y + z * z);
        peakG = Math.max(peakG, g);
        det.setConfirmMs(getState().view?.timers.fallConfirmMs ?? 10_000);
        for (const ev of det.push(x, y, z, t)) {
          if (ev.kind === "move") moving = true;
          else sendSignals({ fall: { peakG: ev.peakG } });
        }
      });
      sensors.motion = "on";
      stops.push(() => sub.remove());
    } else sensors.motion = "unavailable";
  } catch {
    sensors.motion = "unavailable";
  }

  // Battery.
  try {
    battery = (await Battery.getBatteryLevelAsync()) ?? undefined;
    const st = await Battery.getBatteryStateAsync();
    charging = st === Battery.BatteryState.CHARGING || st === Battery.BatteryState.FULL;
    const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => (battery = batteryLevel));
    stops.push(() => sub.remove());
  } catch {}

  // App state: tell the server *before* going quiet, so silence isn't read as a dead phone.
  const onApp = (s: AppStateStatus) => {
    sendSignals({ appState: s === "active" ? "foreground" : "background", heartbeat: true });
  };
  const appSub = AppState.addEventListener("change", onApp);
  stops.push(() => appSub.remove());

  // Heartbeat every 5 s with whatever changed.
  const beat = () => {
    const b: SignalBatch = { heartbeat: true, appState: AppState.currentState === "active" ? "foreground" : "background", sensors: { ...sensors } };
    if (battery !== undefined && battery >= 0) b.battery = battery;
    if (charging !== undefined) b.charging = charging;
    if (!watching) startLocation();
    if (lastFix && (lastFix !== lastSentFix || Date.now() - lastFixSentAt >= FIX_RESEND_MS)) {
      b.fix = lastFix;
      lastSentFix = lastFix;
      lastFixSentAt = Date.now();
    }
    b.motion = { moving, peakG: Math.round(peakG * 10) / 10, windowMs: 5000 };
    moving = false;
    peakG = 1;
    if (pendingInteraction) b.interaction = true;
    pendingInteraction = false;
    sendSignals(b);
  };
  beat();
  const hb = setInterval(beat, 5000);
  stops.push(() => clearInterval(hb));
}

async function startLocation() {
  if (watching || startingLocation || !running) return;
  startingLocation = true;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    sensors.location = perm.granted ? "on" : perm.canAskAgain ? "off" : "denied";
    locationReduced = perm.ios?.accuracy === "reduced";
    if (!perm.granted || !running) return;
    const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 }, (l) => {
      lastFix = fixOf(l);
    });
    if (!running) return sub.remove();
    watching = true;
    stops.push(() => {
      sub.remove();
      watching = false;
    });
    // Don't wait for the watch's first callback (slow indoors): seed with the last known fix right away.
    Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })
      .then((l) => {
        if (l && !lastFix) lastFix = fixOf(l);
      })
      .catch(() => {});
    startBackgroundLocation().catch(() => {});
  } catch {
    sensors.location = "unavailable";
  } finally {
    startingLocation = false;
  }
}

export function stop() {
  running = false;
  watching = false;
  lastFix = lastSentFix = null;
  lastFixSentAt = 0;
  stops.forEach((s) => s());
  stops = [];
  if (Platform.OS !== "web") Location.stopLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => {});
}

async function startBackgroundLocation() {
  // Expo Go on iOS can't run background location; a dev build can (UIBackgroundModes: location).
  if (Platform.OS === "web" || isExpoGo) return;
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) return;
  if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 15,
    timeInterval: 15_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.Other,
  });
}

export function currentFix() {
  return lastFix;
}
