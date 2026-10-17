// Web stand-in for the map (react-native-maps is native-only): members placed on a calm dark grid.

import type { MemberView } from "@shared/protocol";
import { View } from "react-native";
import { colors } from "../theme";
import { Pin } from "./MemberMap.pin";

export function MemberMap({ members, style }: { members: MemberView[]; focusId?: string; style?: any }) {
  const pts = members.filter((m) => m.fix);
  const lats = pts.map((m) => m.fix!.lat);
  const lngs = pts.map((m) => m.fix!.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.002);
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  return (
    <View style={[{ flex: 1, backgroundColor: "#0E1116", overflow: "hidden" }, style]}>
      {Array.from({ length: 12 }, (_, i) => (
        <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: `${(i + 1) * 8}%`, height: 1, backgroundColor: "#1A1F27" }} />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i + 1) * 12}%`, width: 1, backgroundColor: "#1A1F27" }} />
      ))}
      <View style={{ position: "absolute", left: "-10%", right: "-10%", top: "46%", height: 14, backgroundColor: "#1B2230", transform: [{ rotate: "-14deg" }] }} />
      <View style={{ position: "absolute", top: "-10%", bottom: "-10%", left: "38%", width: 10, backgroundColor: "#1B2230", transform: [{ rotate: "8deg" }] }} />
      {pts.map((m) => {
        const x = 50 + ((m.fix!.lng - cLng) / span) * 70;
        const y = 50 - ((m.fix!.lat - cLat) / span) * 70;
        return (
          <View key={m.id} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, marginLeft: -20, marginTop: -20 }}>
            <Pin m={m} />
          </View>
        );
      })}
      <View style={{ position: "absolute", inset: 0, borderColor: colors.hairline }} />
    </View>
  );
}
