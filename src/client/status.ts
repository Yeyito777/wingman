// Pure view helpers for the stage cards (no DOM), so they can be unit-tested.

import type { MemberView } from "../shared/types.ts";
import { esc, fmtM } from "./common.ts";

/** The card's one-line status. Only claims "with the group" when the server actually measured it. */
export function statusLine(m: MemberView): string {
  if (m.risk.reasons.length) return esc(m.risk.summary.charAt(0).toUpperCase() + m.risk.summary.slice(1));
  if (m.distanceFromGroupM !== null) return `With the group${m.distanceFromGroupM > 0 ? ` · ${fmtM(m.distanceFromGroupM)}` : ""}`;
  if (m.presence === "offline") return "Not connected yet";
  if (m.fix) return `Approximate location (±${fmtM(m.fix.accuracy)})`;
  if (m.shareLocation === "alert") return "Shares location only during an alert";
  const loc = m.signals.sensors.location;
  if (loc === "denied" || loc === "off" || loc === "unavailable") return "Location is off on this phone";
  return "Waiting for location…";
}
