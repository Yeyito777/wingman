// One member up close: status, why, where, and what you can do about it.

import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { MemberMap } from "../../components/MemberMap";
import { Avatar, Button, Dot, IconButton, Screen, T } from "../../components/ui";
import { showError } from "../../lib/errors";
import { toneColor, useNow } from "../../lib/hooks";
import { directionsUrl, memberPhone, tel } from "../../lib/links";
import { ack, askCheckin, foundOk } from "../../services/session";
import { ago, capitalize, distanceM, formatDistance, me, memberStatus } from "../../state/reducer";
import { useApp } from "../../state/store";
import { colors, radius } from "../../theme";

export default function Member() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const m = useApp((s) => s.view?.members.find((x) => x.id === id) ?? null);
  const self = useApp(me);
  const now = useNow(5000);
  const [busy, setBusy] = useState<string | null>(null);

  if (!m) {
    return (
      <Screen>
        <View style={{ padding: 16 }}>
          <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  const st = memberStatus(m, now);
  const dist = m.isYou ? null : distanceM(self?.fix, m.fix);
  const run = (k: string, f: () => Promise<unknown>) => async () => {
    setBusy(k);
    try {
      await f();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };
  const iAcked = !!m.alert?.acks.some((a) => a.by === self?.id);
  const last = m.lastCheckin;

  return (
    <Screen edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 52 }}>
        <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 14 }}>
        <View style={{ alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Avatar name={m.name} color={m.color} size={84} />
          <T v="title">{m.isYou ? "You" : m.name}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Dot color={toneColor[st.tone]} />
            <T v="callout" color={colors.text2}>
              {st.label}
              {dist !== null ? ` · ${formatDistance(dist)}` : ""}
            </T>
          </View>
        </View>

        {m.risk.reasons.length > 0 && (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 8 }}>
            <T v="caption" color={colors.text3} style={{ textTransform: "uppercase", letterSpacing: 1 }}>
              What Wingman noticed
            </T>
            {m.risk.reasons.map((r) => (
              <T key={r.code} v="body">
                {capitalize(r.text)}
              </T>
            ))}
          </View>
        )}

        {m.fix && !m.isYou && (
          <View style={{ height: 200, borderRadius: radius.card, overflow: "hidden" }}>
            <MemberMap members={[m, ...(self ? [self] : [])]} focusId={m.id} />
          </View>
        )}

        {m.alert && !m.isYou && (
          <View style={{ gap: 10 }}>
            {!iAcked && <Button title="I'm on my way" kind="danger" icon="walk" busy={busy === "ack"} onPress={run("ack", () => ack(m.id))} />}
            <Button title="I found them, they're OK" kind="secondary" icon="checkmark-circle" busy={busy === "ok"} onPress={run("ok", () => foundOk(m.id))} />
          </View>
        )}

        {!m.isYou && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            {m.fix && <Button title="Directions" kind="secondary" icon="navigate" style={{ flex: 1 }} size="m" onPress={() => Linking.openURL(directionsUrl(m.fix!, m.name))} />}
            {!!memberPhone(m) && <Button title="Call" kind="secondary" icon="call" style={{ flex: 1 }} size="m" onPress={() => Linking.openURL(tel(memberPhone(m)))} />}
          </View>
        )}

        <Button
          title={m.isYou ? "Check in now" : `Ask ${m.name} to check in`}
          kind="secondary"
          icon="mic-outline"
          size="m"
          busy={busy === "ci"}
          onPress={run("ci", async () => {
            await askCheckin(m.id);
            if (m.isYou) router.back();
          })}
        />

        {last?.outcome && (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 4 }}>
            <Ionicons name={last.outcome === "ok" ? "checkmark-circle" : "alert-circle"} size={18} color={last.outcome === "ok" ? colors.green : colors.yellow} />
            <T v="callout" color={colors.text2} style={{ flex: 1 }}>
              Last check-in {ago(last.answeredAt ?? last.askedAt, now)}: {last.outcome === "ok" ? "sounded good" : last.outcome === "missed" ? "no answer" : (last.result?.reason ?? "not quite right")}
            </T>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
