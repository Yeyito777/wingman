// First run: welcome → name → PIN (twice) → medical → emergency contact → permissions, one at a time.

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { KeyboardScreen } from "../components/KeyboardScreen";
import { Logo } from "../components/Logo";
import { PinDots, PinPad } from "../components/PinPad";
import { Button, Field, IconButton, LinkButton, s, Screen, T } from "../components/ui";
import { PERMISSIONS, request, type PermKey } from "../services/permissions";
import { dispatch, getState, savePin } from "../state/store";
import { colors } from "../theme";

type Step = "welcome" | "name" | "pin" | "pin2" | "medical" | "contact" | `perm:${PermKey}`;
const PIN_LEN = 4;
const PIN_PROMPT = "Only you can cancel an alarm about you. Someone who's confused, or who took your phone, can't.";

export default function Onboarding() {
  const p = getState().profile;
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState(p.name);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinError, setPinError] = useState(false);
  const [medical, setMedical] = useState(p.medical);
  const [contactName, setContactName] = useState(p.contactName);
  const [contactPhone, setContactPhone] = useState(p.contactPhone);
  const [phone, setPhone] = useState(p.phone);
  const [busy, setBusy] = useState(false);

  const perms = PERMISSIONS.filter((x) => !(x.key === "background" && Platform.OS === "web"));
  const order: Step[] = ["welcome", "name", "pin", "pin2", "medical", "contact", ...perms.map((x) => `perm:${x.key}` as Step)];
  const idx = order.indexOf(step);
  const next = () => {
    const n = order[idx + 1];
    if (n) setStep(n);
    else finish();
  };
  const back = () => {
    const b = order[idx - 1];
    if (step === "pin2") {
      setPin("");
      setPin2("");
    }
    if (b) setStep(b);
  };
  const saveProfile = () => dispatch({ type: "profile", profile: { name: name.trim(), phone: phone.trim(), medical: medical.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim() } });
  const finish = () => {
    saveProfile();
    dispatch({ type: "onboarded" });
    router.replace("/");
  };

  const digit = (which: "pin" | "pin2") => (d: string) => {
    setPinError(false);
    if (which === "pin") {
      const v = (pin + d).slice(0, PIN_LEN);
      setPin(v);
      if (v.length === PIN_LEN) setTimeout(() => setStep("pin2"), 180);
    } else {
      const v = (pin2 + d).slice(0, PIN_LEN);
      setPin2(v);
      if (v.length === PIN_LEN) {
        if (v === pin) {
          savePin(v).then(() => setTimeout(next, 180));
        } else {
          setPinError(true);
          setTimeout(() => {
            setPin2("");
            setPin("");
            setStep("pin");
          }, 700);
        }
      }
    }
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 16 }}>
      {idx > 0 ? <IconButton icon="chevron-back" label="Back" onPress={back} /> : <View style={{ width: 40 }} />}
      <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 6 }}>
        {idx > 0 &&
          order.slice(1).map((o, i) => <View key={o} style={{ width: i + 1 === idx ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i + 1 <= idx ? colors.text : colors.hairline }} />)}
      </View>
      <View style={{ width: 40 }} />
    </View>
  );

  if (step === "welcome") {
    return (
      <Screen>
        <View style={{ flex: 1, paddingHorizontal: 28, justifyContent: "center" }}>
          <View style={{ marginBottom: 28 }}>
            <Logo size={76} />
          </View>
          <T v="hero">Your friends,{"\n"}watching your back.</T>
          <T v="body" color={colors.text2} style={{ marginTop: 16, fontSize: 19, lineHeight: 27 }}>
            Wingman notices when someone in your group can't ask for help — a fall, a slurred answer, wandering off — and gets the others there.
          </T>
        </View>
        <View style={{ padding: 24, gap: 8 }}>
          <Button title="Get started" onPress={next} size="xl" testID="get-started" />
          <T v="caption" color={colors.text3} center style={{ marginTop: 6 }}>
            Opt in one night at a time. Everything is deleted when the night ends.
          </T>
        </View>
      </Screen>
    );
  }

  if (step === "pin" || step === "pin2") {
    const v = step === "pin" ? pin : pin2;
    return (
      <Screen>
        {header}
        <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 24 }}>
          <T v="title">{step === "pin" ? "Choose a PIN" : pinError ? "PINs didn't match" : "Enter it again"}</T>
          {/* Both steps reserve the height of the longer prompt (invisible copy underneath), so the dots don't jump. */}
          <View style={{ marginTop: 10 }}>
            <View style={{ opacity: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <T v="body">{PIN_PROMPT}</T>
            </View>
            <View style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
              <T v="body" color={colors.text2}>
                {step === "pin" ? PIN_PROMPT : "Type the same PIN once more, just to be sure."}
              </T>
            </View>
          </View>
          <View style={{ marginTop: 44 }} testID="pin-dots">
            <PinDots length={PIN_LEN} filled={v.length} error={pinError} />
          </View>
        </View>
        <View style={{ paddingBottom: 28 }}>
          <PinPad onDigit={digit(step)} onDelete={() => (step === "pin" ? setPin(pin.slice(0, -1)) : setPin2(pin2.slice(0, -1)))} />
        </View>
      </Screen>
    );
  }

  if (step.startsWith("perm:")) {
    const k = step.slice(5) as PermKey;
    const info = PERMISSIONS.find((x) => x.key === k)!;
    const icon = { location: "location", background: "navigate-circle", motion: "walk", mic: "mic", notifications: "notifications" }[k] as any;
    return (
      <Screen>
        {header}
        <View style={{ flex: 1, paddingHorizontal: 28, justifyContent: "center" }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", marginBottom: 28 }}>
            <Ionicons name={icon} size={42} color={colors.text} />
          </View>
          <T v="title">{info.title}</T>
          <T v="body" color={colors.text2} style={{ marginTop: 12, fontSize: 19, lineHeight: 27 }}>
            {info.why}
          </T>
        </View>
        <View style={{ padding: 24, gap: 4 }}>
          <Button
            title="Continue"
            busy={busy}
            testID="perm-continue"
            onPress={async () => {
              setBusy(true);
              await request(k).catch(() => {});
              setBusy(false);
              next();
            }}
          />
          <LinkButton title="Not now" onPress={next} />
        </View>
      </Screen>
    );
  }

  // Text steps
  const textStep = {
    name: { title: "What do your friends call you?", sub: "This is how you'll show up in the group.", ok: name.trim().length > 0, skip: false },
    medical: { title: "Anything a medic should know?", sub: "Allergies, medication, conditions. Shown to your group and to bystanders only if you're in trouble.", ok: true, skip: true },
    contact: { title: "Emergency contact", sub: "Last resort. They get a text if nobody in your group responds.", ok: true, skip: true },
  }[step as "name" | "medical" | "contact"];

  return (
    <Screen>
      <KeyboardScreen
        header={header}
        contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 24, paddingBottom: 12, gap: 12 }}
        footer={
          <>
            <Button
              title="Continue"
              testID="continue"
              disabled={!textStep.ok}
              onPress={() => {
                saveProfile();
                next();
              }}
            />
            {textStep.skip && (
              <LinkButton
                title="Skip"
                onPress={() => {
                  saveProfile();
                  next();
                }}
              />
            )}
          </>
        }
      >
        <T v="title">{textStep.title}</T>
        <T v="body" color={colors.text2} style={{ marginBottom: 16 }}>
          {textStep.sub}
        </T>
        {step === "name" && (
          <>
            <Field>
              <TextInput
                testID="name-input"
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Your first name"
                placeholderTextColor={colors.text3}
                autoFocus
                autoCapitalize="words"
                maxLength={30}
                returnKeyType="next"
                onSubmitEditing={() => name.trim() && next()}
              />
            </Field>
            <Field>
              <TextInput
                style={s.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="Your number (optional)"
                placeholderTextColor={colors.text3}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />
            </Field>
          </>
        )}
        {step === "medical" && (
          <Field>
            <TextInput
              style={[s.input, { minHeight: 120, textAlignVertical: "top" }]}
              value={medical}
              onChangeText={setMedical}
              placeholder="e.g. Allergic to penicillin. Asthma, inhaler in my bag."
              placeholderTextColor={colors.text3}
              multiline
              maxLength={600}
            />
          </Field>
        )}
        {step === "contact" && (
          <>
            <Field>
              <TextInput style={s.input} value={contactName} onChangeText={setContactName} placeholder="Name (e.g. Mom)" placeholderTextColor={colors.text3} autoCapitalize="words" />
            </Field>
            <Field>
              <TextInput
                style={s.input}
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder="Phone number"
                placeholderTextColor={colors.text3}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />
            </Field>
          </>
        )}
      </KeyboardScreen>
    </Screen>
  );
}
