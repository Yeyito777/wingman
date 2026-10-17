// Big numeric keypad with dots. Used to set the PIN and to cancel bystander mode.

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tap } from "../services/alarm";
import { colors, font } from "../theme";

export function PinDots({ length, filled, color = colors.text, error }: { length: number; filled: number; color?: string; error?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 18, justifyContent: "center" }}>
      {Array.from({ length }, (_, i) => (
        <View
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: error ? colors.red : color,
            backgroundColor: i < filled ? (error ? colors.red : color) : "transparent",
          }}
        />
      ))}
    </View>
  );
}

export function PinPad({
  onDigit,
  onDelete,
  dark = true,
  disabled,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  dark?: boolean;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  const fg = dark ? colors.text : colors.black;
  const bg = dark ? colors.surface2 : "rgba(0,0,0,0.08)";
  return (
    <View style={st.grid} pointerEvents={disabled ? "none" : "auto"}>
      {keys.map((k, i) =>
        k === "" ? (
          <View key={i} style={st.key} />
        ) : (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={k === "del" ? "Delete" : k}
            onPress={() => {
              tap();
              k === "del" ? onDelete() : onDigit(k);
            }}
            style={({ pressed }) => [st.key, k !== "del" && { backgroundColor: bg }, pressed && { opacity: 0.5 }, disabled && { opacity: 0.4 }]}
          >
            {k === "del" ? <Ionicons name="backspace-outline" size={28} color={fg} /> : <Text style={[st.digit, { color: fg }]}>{k}</Text>}
          </Pressable>
        ),
      )}
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", width: 3 * 78 + 2 * 22, columnGap: 22, rowGap: 14, alignSelf: "center" },
  key: { width: 78, height: 78, borderRadius: 39, alignItems: "center", justifyContent: "center" },
  digit: { fontSize: 32, fontWeight: "400", fontFamily: font },
});
