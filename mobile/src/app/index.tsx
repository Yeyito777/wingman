import { Redirect } from "expo-router";
import { useApp } from "../state/store";

export default function Index() {
  const onboarded = useApp((s) => s.onboarded);
  const inGroup = useApp((s) => !!s.membership);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href={inGroup ? "/group" : "/start"} />;
}
