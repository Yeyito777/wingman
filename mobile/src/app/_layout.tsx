import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Overlays } from "../components/Overlays";
import { installDevHook } from "../lib/devhook";
import { configureNotifications } from "../services/alarm";
import * as sensors from "../services/sensors";
import * as session from "../services/session";
import { useApp, hydrate } from "../state/store";
import { colors } from "../theme";

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotifications();
installDevHook();

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg } };

export default function RootLayout() {
  const hydrated = useApp((s) => s.hydrated);
  const membership = useApp((s) => s.membership);

  useEffect(() => {
    hydrate().finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, []);

  // In a group: live socket + passive sensing. Out of a group: nothing runs.
  useEffect(() => {
    if (!membership) {
      session.disconnect();
      sensors.stop();
      return;
    }
    session.connect();
    sensors.start();
    session.registerPush();
    // Coming back to the app: reconnect at once instead of waiting out the backoff.
    const sub = AppState.addEventListener("change", (st) => st === "active" && session.reconnectNow());
    return () => sub.remove();
  }, [membership]);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {hydrated && (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "fade" }}>
              <Stack.Screen name="invite" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.75], animation: "slide_from_bottom" }} />
              <Stack.Screen name="settings" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
            </Stack>
          )}
          {hydrated && <Overlays />}
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
