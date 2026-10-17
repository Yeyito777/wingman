// Dark-first palette and type scale. iOS system colours so it feels native.

import { Platform } from "react-native";

export const colors = {
  bg: "#000000",
  surface: "#141416",
  surface2: "#1F1F23",
  hairline: "#2C2C30",
  text: "#FFFFFF",
  text2: "#A1A1A8",
  text3: "#6C6C72",
  accent: "#6E8BFF",
  green: "#32D74B",
  yellow: "#FFD60A",
  orange: "#FF9F0A",
  red: "#FF453A",
  redDeep: "#B3150C",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const font = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif',
  default: undefined,
});

export const type = {
  hero: { fontSize: 40, lineHeight: 44, fontWeight: "800" as const, letterSpacing: -0.8 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -0.5 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const, letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: "400" as const },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: "400" as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
};

export const radius = { card: 20, button: 18, pill: 999 };
export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 };

export const statusColor = (s: "ok" | "watch" | "alert" | "offline" | "unknown") =>
  s === "ok" ? colors.green : s === "watch" ? colors.yellow : s === "alert" ? colors.red : colors.text3;
