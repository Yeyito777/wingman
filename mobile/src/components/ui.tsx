// The small set of building blocks every screen uses. Keep screens to these so the look stays consistent.

import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tap } from "../services/alarm";
import { interaction } from "../services/sensors";
import { colors, font, radius, type } from "../theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function T({
  v = "body",
  color = colors.text,
  center,
  style,
  children,
  numberOfLines,
}: {
  v?: keyof typeof type;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[type[v], { color, fontFamily: font }, center && { textAlign: "center" }, style]}>
      {children}
    </Text>
  );
}

export function Screen({ children, style, edges }: { children: ReactNode; style?: StyleProp<ViewStyle>; edges?: ("top" | "bottom")[] }) {
  return (
    <SafeAreaView edges={edges ?? ["top", "bottom"]} style={[{ flex: 1, backgroundColor: colors.bg }, style]} onTouchStart={interaction}>
      {children}
    </SafeAreaView>
  );
}

type ButtonKind = "primary" | "secondary" | "danger" | "ghost" | "white";

export function Button({
  title,
  onPress,
  kind = "primary",
  icon,
  busy,
  disabled,
  size = "l",
  style,
  testID,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  size?: "l" | "xl" | "m";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const bg = { primary: colors.white, secondary: colors.surface2, danger: colors.red, ghost: "transparent", white: colors.white }[kind];
  const fg = { primary: colors.black, secondary: colors.text, danger: colors.white, ghost: colors.text2, white: colors.redDeep }[kind];
  const h = size === "xl" ? 68 : size === "l" ? 58 : 46;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || busy}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        { height: h, borderRadius: radius.button, backgroundColor: bg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, paddingHorizontal: 20 },
        (disabled || busy) && { opacity: 0.4 },
        pressed && { opacity: 0.75, transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={size === "xl" ? 24 : 20} color={fg} />}
          <Text style={[type.headline, { color: fg, fontFamily: font, fontSize: size === "xl" ? 20 : 17, fontWeight: "700" }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function LinkButton({ title, onPress, color = colors.text2 }: { title: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={12} style={({ pressed }) => [{ padding: 8, alignSelf: "center" }, pressed && { opacity: 0.6 }]}>
      <T v="callout" color={color} style={{ fontWeight: "600" }}>
        {title}
      </T>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color = colors.text }: { icon: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Avatar({ name, color, size = 48, ring }: { name: string; color: string; size?: number; ring?: string }) {
  const parts = name.trim().split(/\s+/);
  const ini = ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + "33",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
      }}
    >
      <Text style={{ color, fontSize: size * 0.38, fontWeight: "700", fontFamily: font }}>{ini}</Text>
    </View>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Field({ children }: { children: ReactNode }) {
  return <View style={s.field}>{children}</View>;
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  field: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 16, minHeight: 56, justifyContent: "center" },
  input: { color: colors.text, fontSize: 20, fontFamily: font, paddingVertical: 14 },
});
