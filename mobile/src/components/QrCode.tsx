import QR from "qrcode";
import { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";

/** A QR code drawn as one SVG path (no network, works in Expo Go and on web). */
export function QrCode({ value, size = 220, fg = "#000", bg = "#fff" }: { value: string; size?: number; fg?: string; bg?: string }) {
  const { d, n } = useMemo(() => {
    const q = QR.create(value, { errorCorrectionLevel: "M" });
    const n = q.modules.size;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(x, y)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d, n: n + 4 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
      <Rect width={n} height={n} fill={bg} rx={1.5} />
      <Path d={d} fill={fg} />
    </Svg>
  );
}
