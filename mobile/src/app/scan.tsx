// Scan a friend's QR code (expo-camera barcode scanning; works in Expo Go).

import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef } from "react";
import { Platform, View } from "react-native";
import { parseJoinLink } from "@shared/protocol";
import { Button, IconButton, Screen, T } from "../components/ui";
import { tap } from "../services/alarm";
import { colors } from "../theme";

export default function Scan() {
  const [perm, ask] = useCameraPermissions();
  const done = useRef(false);

  const onScan = (data: string) => {
    if (done.current) return;
    const code = parseJoinLink(data);
    if (!code) return;
    done.current = true;
    tap("success");
    router.replace({ pathname: "/join", params: { code } });
  };

  return (
    <Screen style={{ backgroundColor: colors.black }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 16, zIndex: 2 }}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
        {Platform.OS !== "web" && perm?.granted ? (
          <View style={{ width: 300, height: 300, borderRadius: 32, overflow: "hidden" }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => onScan(r.data)} />
          </View>
        ) : (
          <View style={{ width: 300, height: 300, borderRadius: 32, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <T v="callout" color={colors.text2} center>
              {Platform.OS === "web" ? "Scanning needs the iPhone app." : "Wingman needs the camera to read the code."}
            </T>
          </View>
        )}
        <T v="title2" center style={{ marginTop: 32 }}>
          Scan your friend's code
        </T>
        <T v="body" color={colors.text2} center style={{ marginTop: 8 }}>
          It's on their screen under “Invite”.
        </T>
      </View>
      {Platform.OS !== "web" && !perm?.granted && (
        <View style={{ padding: 24 }}>
          <Button title="Allow camera" onPress={() => ask()} />
        </View>
      )}
    </Screen>
  );
}
