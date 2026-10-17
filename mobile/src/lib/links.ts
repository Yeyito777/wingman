import type { MemberView } from "@shared/protocol";
import { Platform } from "react-native";

/** Apple Maps walking directions (Google Maps on other platforms). */
export function directionsUrl(to: { lat: number; lng: number }, name: string) {
  const ll = `${to.lat},${to.lng}`;
  if (Platform.OS === "ios") return `maps://?daddr=${ll}&dirflg=w&q=${encodeURIComponent(name)}`;
  return `https://maps.apple.com/?daddr=${ll}&dirflg=w`;
}

/** A member's own number ("" if they didn't give one). */
export function memberPhone(m: MemberView): string {
  return (m.phone ?? "").trim();
}

export const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;
