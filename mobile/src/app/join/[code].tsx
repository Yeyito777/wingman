// Deep link: wingman://join/K7Q2XM
import { Redirect, useLocalSearchParams } from "expo-router";
import { useApp } from "../../state/store";

export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const onboarded = useApp((s) => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href={{ pathname: "/join", params: { code } }} />;
}
