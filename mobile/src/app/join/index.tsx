// Join a night: type the 6-character code, or scan the QR code on a friend's phone.

import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { JOIN_CODE_LENGTH, isJoinCode, normalizeJoinCode } from "@shared/protocol";
import { Button, IconButton, Screen, T } from "../../components/ui";
import { client, joinNight } from "../../services/session";
import { colors, font } from "../../theme";
import { showError } from "../../lib/errors";

export default function Join() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(normalizeJoinCode(params.code ?? ""));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (params.code) setCode(normalizeJoinCode(params.code));
  }, [params.code]);

  // Show "Maya, Sam and Leo are out" once the code is complete.
  useEffect(() => {
    setPreview(null);
    if (!isJoinCode(code)) return;
    let cancelled = false;
    client(undefined, null)
      .preview(code)
      .then((p) => {
        if (cancelled) return;
        const names = p.members.map((m) => m.name);
        setPreview(p.status === "ended" ? "That night has ended." : names.length ? `${listNames(names)} ${names.length === 1 ? "is" : "are"} out tonight.` : p.name);
      })
      .catch(() => !cancelled && setPreview("No night with that code."));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const join = async () => {
    setBusy(true);
    try {
      await joinNight(code);
      router.dismissAll?.();
      router.replace("/group");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 16 }}>
          <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        </View>
        <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 24 }}>
          <T v="title">Join a night out</T>
          <T v="body" color={colors.text2} style={{ marginTop: 10 }}>
            Enter the code on your friend's screen.
          </T>
          <Pressable onPress={() => input.current?.focus()} style={{ flexDirection: "row", gap: 8, marginTop: 36, justifyContent: "center" }}>
            {Array.from({ length: JOIN_CODE_LENGTH }, (_, i) => (
              <View
                key={i}
                style={{
                  width: 48,
                  height: 62,
                  borderRadius: 14,
                  backgroundColor: colors.surface,
                  borderWidth: 2,
                  borderColor: i === code.length ? colors.text2 : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <T v="title" style={{ fontFamily: font }}>
                  {code[i] ?? ""}
                </T>
              </View>
            ))}
          </Pressable>
          <TextInput
            ref={input}
            testID="code-input"
            value={code}
            onChangeText={(t) => setCode(normalizeJoinCode(t))}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={JOIN_CODE_LENGTH + 2}
            style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
          />
          <T v="callout" color={colors.text2} center style={{ marginTop: 20, minHeight: 20 }}>
            {preview ?? ""}
          </T>
        </View>
        <View style={{ padding: 24, gap: 12 }}>
          <Button title="Join" size="xl" testID="join-submit" busy={busy} disabled={!isJoinCode(code)} onPress={join} />
          <Button title="Scan QR code" kind="secondary" icon="scan-outline" onPress={() => router.push("/scan")} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function listNames(n: string[]) {
  if (n.length <= 2) return n.join(" and ");
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
