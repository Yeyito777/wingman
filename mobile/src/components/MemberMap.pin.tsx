import type { MemberView } from "@shared/protocol";
import { Text, View } from "react-native";
import { colors } from "../theme";

export function Pin({ m }: { m: MemberView }) {
  const alert = !!m.alert;
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: alert ? colors.red : m.color,
        borderWidth: 3,
        borderColor: colors.white,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.white, fontWeight: "800", fontSize: 14 }}>{m.isYou ? "You" : m.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
