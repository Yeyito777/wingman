// A friend may be in trouble: full-screen red, why, where, and one big "I'm on my way".

import { Ionicons } from "@expo/vector-icons";
import type { AlertState, MemberView } from "@shared/protocol";
import { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNow } from "../lib/hooks";
import { directionsUrl, memberPhone, tel } from "../lib/links";
import { showError } from "../lib/errors";
import { friendAlert, stopFriendAlert, tap } from "../services/alarm";
import { ack } from "../services/session";
import { alertReasons, distanceM, formatDistance, me } from "../state/reducer";
import { dispatch, useApp } from "../state/store";
import { colors } from "../theme";
import { Button, IconButton, T } from "./ui";

export function AlertTakeover({ alert, member }: { alert: AlertState; member: MemberView }) {
  const self = useApp(me);
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);

  // Alarm runs for as long as the takeover is up (the WS `alert` hint may have started it already).
  useEffect(() => {
    friendAlert(`${member.name} may need help`, alert.trigger);
    return () => stopFriendAlert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.memberId, alert.startedAt]);

  const reasons = alertReasons(member);
  const dist = distanceM(self?.fix, member.fix);
  const others = alert.acks.filter((a) => a.by !== self?.id);
  const done = () => dispatch({ type: "handleAlert", alert });
  const secs = alert.nextEscalationAt ? Math.max(0, Math.round((alert.nextEscalationAt - now) / 1000)) : null;

  return (
    <View style={{ position: "absolute", inset: 0, backgroundColor: colors.redDeep }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, height: 52 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="warning" size={18} color="#FFD3CF" />
            <T v="caption" color="#FFD3CF" style={{ textTransform: "uppercase", letterSpacing: 1.2 }}>
              Wingman alert
            </T>
          </View>
          <IconButton icon="close" label="Dismiss" color={colors.white} onPress={done} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 }}>
          <T v="hero" style={{ fontSize: 44, lineHeight: 46, fontWeight: "900", textTransform: "uppercase" }}>
            {member.name}
            {"\n"}may need help
          </T>
          <View style={{ marginTop: 22, gap: 12 }}>
            {reasons.map((r) => (
              <View key={r} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white, marginTop: 10 }} />
                <T v="body" style={{ fontSize: 20, lineHeight: 26, flex: 1 }}>
                  {r}
                </T>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 26, backgroundColor: "rgba(0,0,0,0.22)", borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name="location" size={26} color={colors.white} />
            <View style={{ flex: 1 }}>
              <T v="headline" style={{ fontSize: 19 }}>
                {dist !== null ? formatDistance(dist) : member.fix ? "Location shared" : "Location unknown"}
              </T>
              {others.length > 0 ? (
                <T v="callout" color="#FFD3CF">
                  {others.map((o) => o.byName).join(", ")} {others.length === 1 ? "is" : "are"} on the way
                </T>
              ) : secs !== null ? (
                <T v="callout" color="#FFD3CF">
                  {alert.stage < 2 ? `Their phone sounds a siren in ${fmt(secs)}` : `Emergency contact texted in ${fmt(secs)}`}
                </T>
              ) : null}
            </View>
            {member.fix && (
              <Button
                title="Directions"
                kind="secondary"
                size="m"
                style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
                onPress={() => Linking.openURL(directionsUrl(member.fix!, member.name))}
              />
            )}
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: 24, paddingBottom: Platform.OS === "web" ? 20 : 8, gap: 12 }}>
          <Button
            title="I'm on my way"
            kind="white"
            size="xl"
            icon="walk"
            busy={busy}
            testID="on-my-way"
            onPress={async () => {
              setBusy(true);
              try {
                await ack(member.id);
                tap("success");
                done();
              } catch (e) {
                showError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button
              title={`Call ${member.name}`}
              kind="secondary"
              icon="call"
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)" }}
              disabled={!memberPhone(member)}
              onPress={() => Linking.openURL(tel(memberPhone(member)))}
            />
            <Button title="911" kind="secondary" icon="medkit" style={{ width: 120, backgroundColor: "rgba(0,0,0,0.25)" }} onPress={() => Linking.openURL("tel:911")} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`);
