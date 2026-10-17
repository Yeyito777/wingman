// AI check-in: Wingman speaks the question, a big mic ring records the answer (stops on silence or after 8 s),
// the server scores it, and we show "You sound good" or let the follow-up take over.

import { Ionicons } from "@expo/vector-icons";
import type { Checkin } from "@shared/protocol";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { audioMode, chimeAndWait, play, tap } from "../services/alarm";
import { speakFully } from "../services/voice";
import { answerCheckin } from "../services/session";
import { dispatch } from "../state/store";
import { colors, font } from "../theme";
import { KeyboardScreen } from "./KeyboardScreen";
import { Button, LinkButton, T } from "./ui";

const MAX_MS = 8000;
const SILENCE_MS = 1400;
const VOICE_DB = -38;

type Phase = "asking" | "ready" | "listening" | "thinking" | "ok" | "notok" | "typing" | "error";

export function CheckinSheet({ checkin }: { checkin: Checkin }) {
  const [phase, setPhase] = useState<Phase>("asking");
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, isMeteringEnabled: true });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  const listening = useRef(false);
  /** still speaking the question: false once the user taps the mic or types (then a stopped utterance isn't retried) */
  const asking = useRef(true);

  useEffect(() => {
    alive.current = true;
    asking.current = true;
    tap("warning");
    // Chime, then the whole question, then the mic: never overlapping (see services/voice.ts).
    (async () => {
      await chimeAndWait();
      if (!alive.current) return;
      const r = await speakFully(checkin.prompt, () => alive.current && asking.current);
      if (!alive.current || !asking.current) return;
      asking.current = false;
      if (r === "done" && checkin.autoListen) listen();
      else setPhase((p) => (p === "asking" ? "ready" : p));
    })();
    return () => {
      alive.current = false;
      Speech.stop();
      stopTimer();
      if (recorder.isRecording) recorder.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin.id]);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  async function listen() {
    if (listening.current) return;
    listening.current = true;
    asking.current = false;
    Speech.stop();
    try {
      await audioMode(true);
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      listening.current = false;
      setPhase("typing");
      return;
    }
    if (!alive.current) {
      recorder.stop().catch(() => {});
      return;
    }
    setPhase("listening");
    const started = Date.now();
    let spoke = false;
    let lastVoice = started;
    timer.current = setInterval(() => {
      const st = recorder.getStatus();
      const db = st.metering ?? -160;
      setLevel(Math.max(0, Math.min(1, (db + 55) / 45)));
      const now = Date.now();
      if (db > VOICE_DB) {
        spoke = true;
        lastVoice = now;
      }
      if (now - started > MAX_MS || (spoke && now - lastVoice > SILENCE_MS && now - started > 1500)) finishRecording(now - started);
    }, 100);
  }

  async function finishRecording(durationMs: number) {
    stopTimer();
    setLevel(0);
    setPhase("thinking");
    listening.current = false;
    try {
      await recorder.stop();
      await audioMode(false);
      const uri = recorder.uri;
      if (!uri) throw new Error("no recording");
      const audio = await readBase64(uri);
      submit({ audio, mime: Platform.OS === "web" ? "audio/webm" : "audio/m4a", durationMs });
    } catch {
      if (alive.current) setPhase("typing");
    }
  }

  async function submit(a: { text?: string; audio?: string; mime?: string; durationMs?: number }) {
    setPhase("thinking");
    try {
      const r = await answerCheckin(checkin.id, a);
      if (!alive.current) return;
      const c = r.checkin;
      if (c?.outcome === "ok") {
        tap("success");
        play("chime");
        setPhase("ok");
        setTimeout(() => c && dispatch({ type: "answered", checkin: c }), 1800);
      } else {
        setNote(c?.result?.reason ? capitalize(c.result.reason) : "Wingman couldn't quite hear you.");
        setPhase("notok");
        setTimeout(() => c && dispatch({ type: "answered", checkin: c }), 3500);
      }
    } catch (e) {
      if (!alive.current) return;
      setNote((e as Error).message);
      setPhase("error");
    }
  }

  const close = () => dispatch({ type: "handleCheckin", id: checkin.id });

  function typeInstead() {
    asking.current = false;
    Speech.stop();
    stopTimer();
    listening.current = false;
    if (recorder.isRecording) recorder.stop().catch(() => {});
    audioMode(false);
    setPhase("typing");
  }

  return (
    <View style={{ position: "absolute", inset: 0, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardScreen
          header={(up) => (
            <View style={{ paddingHorizontal: 28, paddingTop: up ? 12 : 28 }}>
              <T v="caption" color={colors.text3} style={{ textTransform: "uppercase", letterSpacing: 1.2 }}>
                Wingman check-in
              </T>
              <T v="title" style={up ? { marginTop: 6, fontSize: 20, lineHeight: 26 } : { marginTop: 12, fontSize: 28, lineHeight: 35 }}>
                {checkin.prompt.replace(/^Hey, it's Wingman\. /, "")}
              </T>
            </View>
          )}
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12 }}
          footerStyle={(up) => (up ? undefined : { minHeight: 130, justifyContent: "flex-end" })}
          footer={
            <>
              {phase === "typing" ? (
                <>
                  <Button title="Send" disabled={!typed.trim()} onPress={() => submit({ text: typed.trim() })} />
                  <LinkButton title="Speak instead" onPress={() => listen()} />
                </>
              ) : phase === "error" ? (
                <>
                  <Button title="Try again" onPress={() => setPhase("ready")} />
                  <LinkButton title="Close" onPress={close} />
                </>
              ) : phase === "ok" || phase === "notok" ? null : (
                <>
                  <T v="callout" color={colors.text2} center>
                    {phase === "asking" ? "Listen…" : phase === "ready" ? "Tap the mic and answer out loud" : phase === "listening" ? "Listening — tap when you're done" : "Checking your answer…"}
                  </T>
                  {phase !== "thinking" && <LinkButton title="Type instead" onPress={typeInstead} />}
                </>
              )}
            </>
          }
        >
          {phase === "ok" ? (
            <Result icon="checkmark" color={colors.green} title="You sound good" sub="Have a great night." />
          ) : phase === "notok" ? (
            <Result icon="ellipsis-horizontal" color={colors.yellow} title="Thanks" sub={note} />
          ) : phase === "error" ? (
            <Result icon="cloud-offline-outline" color={colors.text2} title="Couldn't send that" sub={note} />
          ) : phase === "typing" ? (
            <View style={{ width: "100%", paddingHorizontal: 28 }}>
              <View style={{ backgroundColor: colors.surface, borderRadius: 18, padding: 16 }}>
                <TextInput
                  autoFocus
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="Where are you, and who are you with?"
                  placeholderTextColor={colors.text3}
                  multiline
                  style={{ color: colors.text, fontSize: 20, fontFamily: font, minHeight: 90 }}
                />
              </View>
            </View>
          ) : (
            <MicRing phase={phase} level={level} onPress={() => (phase === "listening" ? finishRecording(0) : phase !== "thinking" ? listen() : undefined)} />
          )}
        </KeyboardScreen>
      </SafeAreaView>
    </View>
  );
}

function MicRing({ phase, level, onPress }: { phase: Phase; level: number; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const lvl = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  useEffect(() => {
    Animated.timing(lvl, { toValue: level, duration: 100, useNativeDriver: Platform.OS !== "web" }).start();
  }, [level, lvl]);
  const listening = phase === "listening";
  const thinking = phase === "thinking";
  const size = 168;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={listening ? "Stop recording" : "Start recording"} onPress={onPress} style={{ width: 280, height: 280, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: listening ? colors.red : colors.text3,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
        }}
      />
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: listening ? "rgba(255,69,58,0.22)" : "rgba(255,255,255,0.06)",
          transform: [{ scale: lvl.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: listening ? colors.red : thinking ? colors.surface2 : colors.white, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={thinking ? "hourglass-outline" : listening ? "stop" : "mic"} size={64} color={listening ? colors.white : thinking ? colors.text2 : colors.black} />
      </View>
    </Pressable>
  );
}

function Result({ icon, color, title, sub }: { icon: any; color: string; title: string; sub: string }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 32 }}>
      <View style={{ width: 128, height: 128, borderRadius: 64, backgroundColor: color + "26", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={64} color={color} />
      </View>
      <T v="title" center style={{ marginTop: 24 }}>
        {title}
      </T>
      <T v="body" color={colors.text2} center style={{ marginTop: 8 }}>
        {sub}
      </T>
    </View>
  );
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
    return btoa(bin);
  }
  return new File(uri).base64();
}
