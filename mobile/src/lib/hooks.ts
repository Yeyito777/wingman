import { useEffect, useState } from "react";
import type { Tone } from "../state/reducer";
import { useApp } from "../state/store";
import { colors } from "../theme";

export const toneColor: Record<Tone, string> = { ok: colors.green, watch: colors.yellow, alert: colors.red, quiet: colors.text3 };

/** Server-clock "now", re-rendering every `ms`. */
export function useNow(ms = 15_000) {
  const offset = useApp((s) => s.clockOffset);
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t + offset;
}
