// Settings: profile, medical, emergency contact, PIN, server, permissions.

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import { KeyboardScreen } from "../components/KeyboardScreen";
import { IconButton, Screen, T } from "../components/ui";
import { normalizeBaseUrl } from "../api/client";
import { PERMISSIONS, request, status, type PermKey, type PermStatus } from "../services/permissions";
import { client, connect, disconnect } from "../services/session";
import { isExpoGo } from "../services/platform";
import { dispatch, defaultServerUrl, useApp } from "../state/store";
import { colors, font } from "../theme";

export default function Settings() {
  const profile = useApp((s) => s.profile);
  const serverUrl = useApp((s) => s.serverUrl);
  const inGroup = useApp((s) => !!s.membership);
  const [p, setP] = useState(profile);
  const [server, setServer] = useState(serverUrl);
  const [serverState, setServerState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [perms, setPerms] = useState<Record<string, PermStatus>>({});

  const loadPerms = useCallback(async () => {
    const out: Record<string, PermStatus> = {};
    for (const x of PERMISSIONS) out[x.key] = await status(x.key);
    setPerms(out);
  }, []);
  useEffect(() => {
    loadPerms();
  }, [loadPerms]);

  const save = () => {
    dispatch({ type: "profile", profile: { ...p, name: p.name.trim() || profile.name } });
    if (inGroup) {
      client()
        .settings({ medical: p.medical, emergencyContact: { name: p.contactName, phone: p.contactPhone } })
        .catch(() => {});
    }
  };

  const checkServer = async (url: string) => {
    const u = url.trim().toLowerCase() === "mock" ? "mock" : normalizeBaseUrl(url);
    setServer(u);
    if (u !== serverUrl) {
      dispatch({ type: "serverUrl", url: u });
      if (inGroup) {
        disconnect();
        connect();
      }
    }
    if (!u) return setServerState("idle");
    setServerState("checking");
    try {
      await client(u, null).health();
      setServerState("ok");
    } catch {
      setServerState("bad");
    }
  };

  const field = (label: string, key: keyof typeof p, opts: { placeholder?: string; multiline?: boolean; phone?: boolean } = {}) => (
    <Row label={label}>
      <TextInput
        value={p[key]}
        onChangeText={(t) => setP({ ...p, [key]: t })}
        onBlur={save}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.text3}
        multiline={opts.multiline}
        keyboardType={opts.phone ? "phone-pad" : "default"}
        style={{ color: colors.text, fontSize: 17, fontFamily: font, paddingVertical: 4, textAlign: opts.multiline ? "left" : "right", flex: 1, minWidth: 120 }}
      />
    </Row>
  );

  return (
    <Screen>
      <KeyboardScreen
        header={
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 56 }}>
            <T v="title2" style={{ flex: 1, paddingLeft: 4 }}>
              Settings
            </T>
            <IconButton
              icon="close"
              label="Done"
              onPress={() => {
                save();
                router.back();
              }}
            />
          </View>
        }
        contentContainerStyle={{ padding: 20, gap: 26, paddingBottom: 60 }}
      >
        <Section title="You">
          {field("Name", "name")}
          {field("Phone", "phone", { placeholder: "Optional", phone: true })}
        </Section>
        <Section title="Medical info" footer="Shown to your group and to bystanders only if you may need help.">
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <TextInput
              value={p.medical}
              onChangeText={(t) => setP({ ...p, medical: t })}
              onBlur={save}
              multiline
              placeholder="Allergies, medication, conditions"
              placeholderTextColor={colors.text3}
              style={{ color: colors.text, fontSize: 17, fontFamily: font, minHeight: 60, textAlignVertical: "top" }}
            />
          </View>
        </Section>
        <Section title="Emergency contact" footer="Texted only if nobody in your group responds.">
          {field("Name", "contactName", { placeholder: "e.g. Mom" })}
          {field("Phone", "contactPhone", { placeholder: "+1 …", phone: true })}
        </Section>
        <Section title="Security">
          <Pressable onPress={() => router.push("/onboarding")} style={{ paddingHorizontal: 16, height: 50, flexDirection: "row", alignItems: "center" }}>
            <T v="body" style={{ flex: 1 }}>
              Change PIN & profile
            </T>
            <Ionicons name="chevron-forward" size={18} color={colors.text3} />
          </Pressable>
        </Section>
        <Section title="Permissions" footer={isExpoGo ? "Expo Go can't keep location running with the screen locked. The installed Wingman app can." : undefined}>
          {PERMISSIONS.map((x, i) => (
            <PermRow
              key={x.key}
              first={i === 0}
              title={x.title}
              st={perms[x.key]}
              onPress={async () => {
                const st = perms[x.key];
                if (st === "denied") Linking.openSettings().catch(() => {});
                else if (st === "undetermined") await request(x.key as PermKey);
                loadPerms();
              }}
            />
          ))}
        </Section>
        <Section title="Server" footer={serverState === "ok" ? "Connected." : serverState === "bad" ? "Can't reach that server." : serverState === "checking" ? "Checking…" : "Where your group's night is coordinated."}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 6, flexDirection: "row", alignItems: "center" }}>
            <TextInput
              value={server}
              onChangeText={setServer}
              onBlur={() => checkServer(server)}
              onSubmitEditing={() => checkServer(server)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://…"
              placeholderTextColor={colors.text3}
              style={{ color: colors.text, fontSize: 15, fontFamily: font, paddingVertical: 8, flex: 1 }}
            />
            {serverState === "ok" && <Ionicons name="checkmark-circle" size={20} color={colors.green} />}
            {serverState === "bad" && <Ionicons name="alert-circle" size={20} color={colors.red} />}
          </View>
          {defaultServerUrl() && server !== defaultServerUrl() && (
            <Pressable onPress={() => checkServer(defaultServerUrl())} style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <T v="callout" color={colors.accent}>
                Use default
              </T>
            </Pressable>
          )}
        </Section>
      </KeyboardScreen>
    </Screen>
  );
}

function Section({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  return (
    <View>
      <T v="caption" color={colors.text3} style={{ textTransform: "uppercase", letterSpacing: 1, marginLeft: 16, marginBottom: 8 }}>
        {title}
      </T>
      <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden" }}>{children}</View>
      {footer && (
        <T v="caption" color={colors.text3} style={{ marginHorizontal: 16, marginTop: 8, fontWeight: "400" }}>
          {footer}
        </T>
      )}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, minHeight: 50, gap: 12, borderBottomWidth: 0.5, borderColor: colors.hairline }}>
      <T v="body">{label}</T>
      {children}
    </View>
  );
}

function PermRow({ title, st, onPress, first }: { title: string; st?: PermStatus; onPress: () => void; first: boolean }) {
  const label = st === "granted" ? "On" : st === "denied" ? "Off — open Settings" : st === "unavailable" ? "Not available here" : st === "undetermined" ? "Turn on" : "…";
  const color = st === "granted" ? colors.green : st === "undetermined" ? colors.accent : colors.text3;
  return (
    <Pressable
      onPress={onPress}
      disabled={st === "granted" || st === "unavailable"}
      style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 50, borderTopWidth: first ? 0 : 0.5, borderColor: colors.hairline }}
    >
      <T v="body" style={{ flex: 1 }}>
        {title}
      </T>
      <T v="callout" color={color}>
        {label}
      </T>
    </Pressable>
  );
}
