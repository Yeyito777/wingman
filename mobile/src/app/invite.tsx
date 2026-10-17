// Invite: the join code, big, and a QR code a friend scans from the Wingman app.

import { router } from "expo-router";
import { Platform, Share, View } from "react-native";
import { QrCode } from "../components/QrCode";
import { Button, IconButton, Screen, T } from "../components/ui";
import { useApp } from "../state/store";
import { colors, font } from "../theme";

export default function Invite() {
  const view = useApp((s) => s.view);
  const memberCode = useApp((s) => s.membership?.code);
  const code = view?.code ?? memberCode ?? "";
  const url = view?.links.joinUrl ?? `wingman://join/${code}`;
  return (
    <Screen edges={Platform.OS === "ios" ? ["bottom"] : ["top", "bottom"]} style={{ backgroundColor: colors.surface }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 16 }}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} />
      </View>
      <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 28 }}>
        <T v="title" center>
          Invite your friends
        </T>
        <T v="body" color={colors.text2} center style={{ marginTop: 8 }}>
          They open Wingman, tap “Join with code”, and scan this.
        </T>
        <View style={{ marginTop: 28, padding: 14, backgroundColor: colors.white, borderRadius: 24 }}>
          <QrCode value={url} size={210} />
        </View>
        <T v="caption" color={colors.text3} style={{ marginTop: 28, textTransform: "uppercase", letterSpacing: 1.2 }}>
          or enter the code
        </T>
        <T v="hero" style={{ fontFamily: Platform.select({ ios: "Menlo", default: font }), letterSpacing: 6, marginTop: 6 }}>
          {code}
        </T>
      </View>
      <View style={{ padding: 24 }}>
        <Button
          title="Share link"
          kind="secondary"
          icon="share-outline"
          onPress={() => Share.share({ message: `Join my Wingman night out: ${url} (code ${code})` }).catch(() => {})}
        />
      </View>
    </Screen>
  );
}
