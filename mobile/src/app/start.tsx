// Not in a group: start a night out, or join one.

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { showError } from "../lib/errors";
import { Button, IconButton, Screen, T } from "../components/ui";
import { startNight } from "../services/session";
import { dispatch, useApp } from "../state/store";
import { colors } from "../theme";

export default function Start() {
  const name = useApp((s) => s.profile.name);
  const ended = useApp((s) => s.endedReason);
  const server = useApp((s) => s.serverUrl);
  const [busy, setBusy] = useState(false);
  const hour = new Date().getHours();
  const greet = hour >= 17 || hour < 4 ? "Good evening" : hour < 12 ? "Good morning" : "Hey";

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, height: 52, alignItems: "center" }}>
        <IconButton icon="settings-outline" label="Settings" onPress={() => router.push("/settings")} />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 28, justifyContent: "center" }}>
        <T v="title2" color={colors.text2}>
          {greet}, {name || "there"}
        </T>
        <T v="hero" style={{ marginTop: 6 }}>
          Going out{"\n"}tonight?
        </T>
        <T v="body" color={colors.text2} style={{ marginTop: 14, fontSize: 19, lineHeight: 27 }}>
          Start a night and invite your friends. Everyone looks out for everyone.
        </T>
        {ended && (
          <View style={{ marginTop: 28, flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.surface, borderRadius: 16, padding: 14 }}>
            <Ionicons name="checkmark-circle" size={22} color={colors.green} />
            <T v="callout" color={colors.text2} style={{ flex: 1 }}>
              {ended}
            </T>
          </View>
        )}
      </View>
      <View style={{ padding: 24, gap: 12 }}>
        <Button
          title="Start a night out"
          size="xl"
          testID="start-night"
          busy={busy}
          onPress={async () => {
            if (!server) {
              router.push("/settings");
              return;
            }
            setBusy(true);
            try {
              dispatch({ type: "left", reason: null });
              await startNight();
              router.replace("/group");
            } catch (e) {
              showError(e);
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button title="Join with code" kind="secondary" size="xl" icon="qr-code-outline" testID="join" onPress={() => router.push("/join")} />
      </View>
    </Screen>
  );
}
