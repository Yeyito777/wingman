// Web only: a handle for the screenshot script (tools/screenshots.ts) to drive the app against the mock server.

import { router } from "expo-router";
import { Platform } from "react-native";
import { setMockScene, type MockScene } from "../api/mock";
import { startNight } from "../services/session";
import { dispatch, getState, savePin } from "../state/store";

export function installDevHook() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  // iOS has no focus rings on text fields; match that in the browser preview.
  const css = document.createElement("style");
  css.textContent = "input, textarea { outline: none !important; caret-color: #6E8BFF; }";
  document.head.appendChild(css);
  (window as any).__wingman = {
    router,
    dispatch,
    getState,
    savePin,
    async mockNight(name = "Yeyito") {
      await savePin("1234");
      dispatch({ type: "serverUrl", url: "mock" });
      dispatch({
        type: "profile",
        profile: { name, phone: "+1 416 555 0123", medical: "Allergic to penicillin. Asthma, inhaler in left jacket pocket.", contactName: "Mom", contactPhone: "+1 416 555 0199" },
      });
      dispatch({ type: "onboarded" });
      await startNight();
    },
    scene(s: MockScene) {
      setMockScene(s);
    },
  };
}
