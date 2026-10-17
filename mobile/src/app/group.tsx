// Group home: everyone in tonight's group as a card (you included), a map toggle, and one way out.

import type { MemberView } from "@shared/protocol";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { toneColor, useNow } from "../lib/hooks";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { MemberMap } from "../components/MemberMap";
import { Avatar, Button, Dot, IconButton, Screen, T } from "../components/ui";
import { endNight } from "../services/session";
import { distanceM, formatDistance, me, memberStatus, orderedMembers } from "../state/reducer";
import { useApp } from "../state/store";
import { colors, radius } from "../theme";
import { showError } from "../lib/errors";

export default function Group() {
  const view = useApp((s) => s.view);
  const self = useApp(me);
  const connection = useApp((s) => s.connection);
  const inGroup = useApp((s) => !!s.membership);
  const [mode, setMode] = useState<"list" | "map">("list");
  const now = useNow();

  useEffect(() => {
    if (!inGroup) router.replace("/start");
  }, [inGroup]);

  const members = orderedMembers(view);
  const others = members.filter((m) => !m.isYou);

  const onEnd = () => {
    const leave = () => endNight(false).catch(showError);
    const end = () => endNight(true).catch(showError);
    if (Platform.OS === "web") {
      if ((globalThis as any).confirm?.("End the night for everyone? All data is deleted.")) end();
      return;
    }
    Alert.alert("Heading home?", "Ending the night deletes everyone's data. Leaving keeps the others covered.", [
      { text: "I'm heading home", onPress: leave },
      { text: "End night for everyone", style: "destructive", onPress: end },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Screen edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="caption" color={colors.text3} style={{ textTransform: "uppercase", letterSpacing: 1 }}>
            {others.length ? `${members.length} of you tonight` : "Tonight"}
          </T>
          <T v={(view?.name.length ?? 0) > 16 ? "title2" : "title"} numberOfLines={1}>
            {view?.name ?? "Your night out"}
          </T>
        </View>
        <IconButton icon="person-add-outline" label="Invite friends" onPress={() => router.push("/invite")} />
        <IconButton icon="settings-outline" label="Settings" onPress={() => router.push("/settings")} />
      </View>

      <View style={{ flexDirection: "row", marginHorizontal: 20, backgroundColor: colors.surface, borderRadius: 12, padding: 3, marginBottom: 12 }}>
        {(["list", "map"] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            onPress={() => setMode(m)}
            style={{ flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: mode === m ? colors.surface2 : "transparent" }}
          >
            <T v="callout" color={mode === m ? colors.text : colors.text2} style={{ fontWeight: "600" }}>
              {m === "list" ? "People" : "Map"}
            </T>
          </Pressable>
        ))}
      </View>

      {connection === "closed" && (
        <View style={{ alignSelf: "center", backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8 }}>
          <T v="caption" color={colors.text2}>
            Reconnecting…
          </T>
        </View>
      )}

      {mode === "map" ? (
        <View style={{ flex: 1, marginHorizontal: 20, borderRadius: radius.card, overflow: "hidden" }}>
          <MemberMap members={members} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
          {members.map((m) => (
            <MemberCard key={m.id} m={m} self={self} now={now} />
          ))}
          {!others.length && (
            <Pressable onPress={() => router.push("/invite")} style={{ borderRadius: radius.card, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.hairline, padding: 22, alignItems: "center", gap: 6 }}>
              <T v="headline">Invite your friends</T>
              <T v="callout" color={colors.text2} center>
                Wingman works best when everyone you're out with has it.
              </T>
            </Pressable>
          )}
        </ScrollView>
      )}

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "web" ? 20 : 34, borderTopWidth: 0.5, borderColor: colors.hairline }}>
        <Button title="I'm heading home" kind="secondary" icon="home-outline" onPress={onEnd} testID="end-night" />
      </View>
    </Screen>
  );
}

function MemberCard({ m, self, now }: { m: MemberView; self: MemberView | null; now: number }) {
  const st = memberStatus(m, now, self?.id);
  const dist = m.isYou ? null : distanceM(self?.fix, m.fix);
  const alert = st.tone === "alert";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/member/[id]", params: { id: m.id } })}
      style={({ pressed }) => [
        {
          backgroundColor: alert ? "#2A0B09" : colors.surface,
          borderRadius: radius.card,
          padding: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          borderWidth: alert ? 1.5 : 0,
          borderColor: colors.red,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View>
        <Avatar name={m.name} color={m.color} size={52} />
        <View style={{ position: "absolute", right: -1, bottom: -1, borderWidth: 3, borderColor: alert ? "#2A0B09" : colors.surface, borderRadius: 10 }}>
          <Dot color={toneColor[st.tone]} size={14} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <T v="headline" style={{ fontSize: 19 }}>
          {m.isYou ? "You" : m.name}
        </T>
        <T v="callout" color={alert ? "#FF9A92" : colors.text2} numberOfLines={1} style={{ marginTop: 2 }}>
          {st.label}
        </T>
      </View>
      {dist !== null && (
        <T v="callout" color={colors.text3}>
          {formatDistance(dist)}
        </T>
      )}
    </Pressable>
  );
}
