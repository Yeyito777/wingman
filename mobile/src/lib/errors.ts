import { Alert, Platform } from "react-native";

export function showError(e: unknown) {
  const msg = (e as Error)?.message ?? String(e);
  if (Platform.OS === "web") (globalThis as any).alert?.(msg);
  else Alert.alert("Something went wrong", msg);
}
