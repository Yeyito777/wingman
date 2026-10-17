// A tiny global store around the pure reducer, plus persistence. Screens read it with useApp(selector).

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useRef, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { initialState, reducer, type Action, type Membership, type Profile, type State } from "./reducer";

let state: State = initialState;
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function dispatch(a: Action) {
  const next = reducer(state, a);
  if (next === state) return;
  const prev = state;
  state = next;
  persist(prev, next);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Subscribe to a slice of state. The selector result is cached per state object, so selectors may build new
 *  objects/arrays without causing render loops. */
export function useApp<T>(select: (s: State) => T): T {
  const cache = useRef<{ s: State; v: T } | null>(null);
  const get = () => {
    if (!cache.current || cache.current.s !== state) cache.current = { s: state, v: select(state) };
    return cache.current.v;
  };
  return useSyncExternalStore(subscribe, get, get);
}

// ---------------------------------------------------------------- persistence

const K = {
  profile: "wingman.profile",
  onboarded: "wingman.onboarded",
  server: "wingman.server",
  membership: "wingman.membership",
  pin: "wingman.pin",
};

const secure = {
  async get(k: string) {
    if (Platform.OS === "web") return AsyncStorage.getItem(k);
    return SecureStore.getItemAsync(k);
  },
  async set(k: string, v: string | null) {
    if (Platform.OS === "web") return v === null ? AsyncStorage.removeItem(k) : AsyncStorage.setItem(k, v);
    return v === null ? SecureStore.deleteItemAsync(k) : SecureStore.setItemAsync(k, v);
  },
};

export function defaultServerUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string };
  return extra.serverUrl ?? "";
}

export async function hydrate() {
  const [profile, onboarded, server, membership] = await Promise.all([
    AsyncStorage.getItem(K.profile),
    AsyncStorage.getItem(K.onboarded),
    AsyncStorage.getItem(K.server),
    secure.get(K.membership),
  ]);
  const parse = <T,>(s: string | null): T | null => {
    try {
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  };
  dispatch({
    type: "hydrate",
    profile: parse<Profile>(profile),
    membership: parse<Membership>(membership),
    serverUrl: server || defaultServerUrl(),
    onboarded: onboarded === "1",
  });
}

function persist(prev: State, next: State) {
  if (!next.hydrated) return;
  if (prev.profile !== next.profile) AsyncStorage.setItem(K.profile, JSON.stringify(next.profile)).catch(() => {});
  if (prev.onboarded !== next.onboarded) AsyncStorage.setItem(K.onboarded, next.onboarded ? "1" : "0").catch(() => {});
  if (prev.serverUrl !== next.serverUrl && prev.hydrated) AsyncStorage.setItem(K.server, next.serverUrl).catch(() => {});
  if (prev.membership !== next.membership) secure.set(K.membership, next.membership ? JSON.stringify(next.membership) : null).catch(() => {});
}

export const savePin = (pin: string) => secure.set(K.pin, pin);
export const loadPin = () => secure.get(K.pin);
