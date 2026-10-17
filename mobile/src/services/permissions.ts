// One place for every permission Wingman uses: ask, and report status for Settings.

import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { DeviceMotion } from "expo-sensors";
import { Platform } from "react-native";
import { isExpoGo } from "./platform";
import { sensors } from "./sensors";

export type PermKey = "location" | "background" | "motion" | "mic" | "notifications";
export type PermStatus = "granted" | "denied" | "undetermined" | "unavailable";

export const PERMISSIONS: { key: PermKey; title: string; why: string; icon: string }[] = [
  {
    key: "location",
    title: "Location",
    why: "So your friends can find you, and so Wingman notices if you drift away from the group.",
    icon: "location",
  },
  {
    key: "motion",
    title: "Motion",
    why: "To notice a hard fall followed by stillness, even if you can't reach your phone.",
    icon: "motion",
  },
  {
    key: "mic",
    title: "Microphone",
    why: "Wingman asks you a quick question now and then. Your answer is checked, then thrown away.",
    icon: "mic",
  },
  {
    key: "notifications",
    title: "Notifications",
    why: "So you hear about it right away when a friend needs you, even with the app closed.",
    icon: "bell",
  },
  {
    key: "background",
    title: "Always-on location",
    why: "Keeps you covered with the screen locked. Choose “Always Allow” when iPhone asks.",
    icon: "location",
  },
];

const norm = (p: { granted: boolean; canAskAgain?: boolean; status?: string }): PermStatus =>
  p.granted ? "granted" : p.status === "undetermined" || (p.canAskAgain ?? true) ? "undetermined" : "denied";

export async function status(k: PermKey): Promise<PermStatus> {
  try {
    switch (k) {
      case "location":
        return norm(await Location.getForegroundPermissionsAsync());
      case "background":
        if (Platform.OS === "web" || isExpoGo) return "unavailable";
        return norm(await Location.getBackgroundPermissionsAsync());
      case "motion":
        if (Platform.OS === "web") return "unavailable";
        return norm(await DeviceMotion.getPermissionsAsync());
      case "mic":
        return norm(await getRecordingPermissionsAsync());
      case "notifications":
        if (Platform.OS === "web") return "unavailable";
        return norm(await Notifications.getPermissionsAsync());
    }
  } catch {
    return "unavailable";
  }
}

export async function request(k: PermKey): Promise<PermStatus> {
  try {
    let r: PermStatus;
    switch (k) {
      case "location":
        r = norm(await Location.requestForegroundPermissionsAsync());
        sensors.location = r === "granted" ? "on" : "denied";
        return r;
      case "background":
        if (Platform.OS === "web" || isExpoGo) return "unavailable";
        return norm(await Location.requestBackgroundPermissionsAsync());
      case "motion":
        if (Platform.OS === "web") return "unavailable";
        r = norm(await DeviceMotion.requestPermissionsAsync());
        sensors.motion = r === "granted" ? "on" : "denied";
        return r;
      case "mic":
        r = norm(await requestRecordingPermissionsAsync());
        sensors.mic = r === "granted" ? "on" : "denied";
        return r;
      case "notifications":
        if (Platform.OS === "web") return "unavailable";
        r = norm(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowCriticalAlerts: true } }));
        sensors.notifications = r === "granted" ? "on" : "denied";
        return r;
    }
  } catch {
    return "unavailable";
  }
}

export async function refreshSensorReport() {
  const [loc, mic, notif] = await Promise.all([status("location"), status("mic"), status("notifications")]);
  const m = (s: PermStatus) => (s === "granted" ? "on" : s === "denied" ? "denied" : s === "unavailable" ? "unavailable" : "off");
  sensors.location = m(loc);
  sensors.mic = m(mic);
  sensors.notifications = m(notif);
}
