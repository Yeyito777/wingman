// Bystander mode: this phone's owner may be in trouble and nobody in the group has responded.
// Flashing red/white, a siren, what a stranger should do, and "I'm OK" behind the owner's PIN.

import { Ionicons } from "@expo/vector-icons";
import type { AlertState } from "@shared/protocol";
import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useRef, useState } from "react";
import { Animated, Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tel } from "../lib/links";
import { startSiren, stopSiren, tap } from "../services/alarm";
import { cancelOwnAlert } from "../services/session";
import { me } from "../state/reducer";
import { useApp } from "../state/store";
import { colors, font } from "../theme";
import { PinDots, PinPad } from "./PinPad";
import { Button, T } from "./ui";

const PIN_LEN = 4;

export function Bystander({ alert }: { alert: AlertState }) {
  useKeepAwake("bystander");
  const self = useApp(me);
  const flash = useRef(new Animated.Value(0)).current;
  const [pinMode, setPinMode] = useState(false);

  useEffect(() => {
    startSiren();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 450, useNativeDriver: false }),
        Animated.timing(flash, { toValue: 0, duration: 450, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      stopSiren();
    };
  }, [flash]);

  const bg = flash.interpolate({ inputRange: [0, 1], outputRange: [colors.red, "#FFFFFF"] });
  const fg = flash.interpolate({ inputRange: [0, 1], outputRange: ["#FFFFFF", colors.redDeep] });
  const name = self?.name ?? alert.memberName;
  const contact = self?.emergencyContact;

  if (pinMode) return <PinCancel onBack={() => setPinMode(false)} />;

  return (
    <View style={{ position: "absolute", inset: 0, backgroundColor: colors.redDeep }}>
      <Animated.View style={{ backgroundColor: bg }}>
        <SafeAreaView edges={["top"]}>
          <Animated.Text
            style={{ color: fg, fontFamily: font, fontSize: 46, lineHeight: 48, fontWeight: "900", textAlign: "center", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 22 }}
          >
            THIS PERSON MAY NEED HELP
          </Animated.Text>
        </SafeAreaView>
      </Animated.View>
      <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <T v="title2" center style={{ fontSize: 24 }}>
            Their name is {name}. Please stay with them.
          </T>
          <Button title="CALL 911" kind="white" size="xl" icon="call" style={{ height: 84 }} onPress={() => Linking.openURL("tel:911")} testID="call-911" />
          {!!self?.medical && (
            <View style={{ backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 18, padding: 16 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <Ionicons name="medkit" size={18} color="#FFD3CF" />
                <T v="caption" color="#FFD3CF" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                  Medical info
                </T>
              </View>
              <T v="body" style={{ fontSize: 20, lineHeight: 27 }}>
                {self.medical}
              </T>
            </View>
          )}
          {!!contact?.phone && (
            <Pressable
              onPress={() => Linking.openURL(tel(contact.phone))}
              style={({ pressed }) => [{ backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <T v="caption" color="#FFD3CF" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                  Emergency contact
                </T>
                <T v="headline" style={{ fontSize: 20, marginTop: 4 }}>
                  {contact.name || "Contact"} · {contact.phone}
                </T>
              </View>
              <Ionicons name="call" size={24} color={colors.white} />
            </Pressable>
          )}
          {alert.acks.length > 0 && (
            <T v="body" center color="#FFD3CF">
              {alert.acks.map((a) => a.byName).join(", ")} {alert.acks.length === 1 ? "is" : "are"} on the way.
            </T>
          )}
        </ScrollView>
        <View style={{ paddingHorizontal: 20, paddingBottom: Platform.OS === "web" ? 16 : 4 }}>
          <Button title="I'm OK" kind="secondary" onPress={() => setPinMode(true)} style={{ backgroundColor: "rgba(0,0,0,0.28)" }} testID="im-ok" />
        </View>
      </SafeAreaView>
    </View>
  );
}

function PinCancel({ onBack }: { onBack: () => void }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const digit = async (d: string) => {
    if (busy) return;
    const v = (pin + d).slice(0, PIN_LEN);
    setPin(v);
    setMsg("");
    if (v.length < PIN_LEN) return;
    setBusy(true);
    const err = await cancelOwnAlert(v);
    setBusy(false);
    if (err) {
      tap("warning");
      setMsg(err);
      setPin("");
    } else tap("success");
  };
  return (
    <View style={{ position: "absolute", inset: 0, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 40, alignItems: "center" }}>
          <T v="title" center>
            Enter your PIN
          </T>
          <T v="body" color={msg ? colors.red : colors.text2} center style={{ marginTop: 10, minHeight: 24 }}>
            {msg || "To turn off the alarm and tell your friends you're OK."}
          </T>
          <View style={{ marginTop: 36 }}>
            <PinDots length={PIN_LEN} filled={pin.length} error={!!msg} />
          </View>
        </View>
        <View style={{ paddingBottom: 16, gap: 12 }}>
          <PinPad onDigit={digit} onDelete={() => setPin(pin.slice(0, -1))} disabled={busy} />
          <Button title="Back" kind="ghost" size="m" onPress={onBack} />
        </View>
      </SafeAreaView>
    </View>
  );
}
