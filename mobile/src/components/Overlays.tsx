// Whatever must take over the screen right now (see `overlay()` in the reducer for the priority order).

import { useApp } from "../state/store";
import { overlay } from "../state/reducer";
import { AlertTakeover } from "./AlertTakeover";
import { Bystander } from "./Bystander";
import { CheckinSheet } from "./CheckinSheet";

export function Overlays() {
  const o = useApp(overlay);
  if (!o) return null;
  if (o.kind === "bystander") return <Bystander alert={o.alert} />;
  if (o.kind === "alert") return <AlertTakeover key={`${o.alert.memberId}:${o.alert.startedAt}`} alert={o.alert} member={o.member} />;
  return <CheckinSheet key={o.checkin.id} checkin={o.checkin} />;
}
