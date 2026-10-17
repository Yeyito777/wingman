// Every screen with a text field: a header, a scrolling body and a sticky footer (the primary button) that rides above
// the keyboard, with the focused field scrolled into view.
//
// Why not KeyboardAvoidingView: it computes the overlap from its onLayout frame, which is relative to its parent, not
// the window. Inside a SafeAreaView it under-pads by the top inset (47 pt on an iPhone 13), and inside a sheet by the
// sheet's offset, so buttons ended up behind the keyboard. This measures itself in window coordinates instead.
// Plain React Native (Keyboard events + measureInWindow): no native module.

import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  TextInput,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** Gap kept between the focused field and the top of the footer / keyboard. */
const FIELD_MARGIN = 16;

type Listener = (screenY: number | null, duration: number) => void;
const simulated = new Set<Listener>();

/** Web previews only (tools/screenshots.ts): pretend a keyboard's top edge is at `screenY` (null = hidden). */
export function simulateKeyboard(screenY: number | null) {
  for (const l of simulated) l(screenY, 0);
}

/** Keyboard top in window coordinates while it's showing, else null. iOS events; web via simulateKeyboard. */
function useKeyboardTop(onChange: (screenY: number | null, duration: number) => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (Platform.OS === "web") {
      const l: Listener = (y, d) => cb.current(y, d);
      simulated.add(l);
      return () => void simulated.delete(l);
    }
    if (Platform.OS !== "ios") return; // Android resizes the window itself (adjustResize)
    const change = (e: KeyboardEvent) => cb.current(e.endCoordinates.height > 0 ? e.endCoordinates.screenY : null, e.duration);
    const subs = [
      Keyboard.addListener("keyboardWillChangeFrame", change),
      Keyboard.addListener("keyboardWillShow", change),
      Keyboard.addListener("keyboardWillHide", (e) => cb.current(null, e.duration)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
}

/** The focused text field: a host instance on iOS; on web (no TextInput.State.currentlyFocusedInput) a DOM node. */
function focusedInput(): unknown {
  if (Platform.OS === "web") return typeof document !== "undefined" && document.activeElement !== document.body ? document.activeElement : null;
  return TextInput.State.currentlyFocusedInput?.() ?? null;
}

/** Window y + height of a native view (measureInWindow), or of a DOM node on web (focused inputs are DOM nodes). */
function measure(node: unknown, cb: (y: number, h: number) => void) {
  const n = node as {
    measureInWindow?: (f: (x: number, y: number, w: number, h: number) => void) => void;
    getBoundingClientRect?: () => { y: number; height: number };
  } | null;
  if (n?.measureInWindow) n.measureInWindow((_x, y, _w, h) => cb(y, h));
  else if (n?.getBoundingClientRect) {
    const r = n.getBoundingClientRect();
    cb(r.y, r.height);
  }
}

export function KeyboardScreen({
  header,
  footer,
  children,
  contentContainerStyle,
  footerStyle,
  scroll = true,
}: {
  /** Above the scrolling body. A function gets whether the keyboard is up (to compact itself). */
  header?: ReactNode | ((keyboardUp: boolean) => ReactNode);
  /** Sticky at the bottom, above the keyboard. A function gets whether the keyboard is up (to compact itself). */
  footer?: ReactNode | ((keyboardUp: boolean) => ReactNode);
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  footerStyle?: StyleProp<ViewStyle> | ((keyboardUp: boolean) => StyleProp<ViewStyle>);
  /** false: the body is a plain flex View (it must fit by itself) */
  scroll?: boolean;
}) {
  const outer = useRef<ComponentRef<typeof View>>(null);
  const body = useRef<ComponentRef<typeof View>>(null);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const [pad, setPad] = useState(0);
  const up = pad > 0;

  useKeyboardTop((screenY, duration) => {
    if (screenY === null) return apply(0, duration);
    outer.current?.measureInWindow((_x, y, _w, h) => apply(Math.max(0, Math.round(y + h - screenY)), duration));
  });

  const padNow = useRef(0);
  function apply(p: number, duration: number) {
    if (p === padNow.current) return;
    padNow.current = p;
    // Move with the keyboard's own animation curve.
    if (Platform.OS === "ios") LayoutAnimation.configureNext({ duration: Math.max(duration || 250, 10), update: { type: LayoutAnimation.Types.keyboard } });
    setPad(p);
  }

  /** Scroll the focused field into the visible part of the body (between the header and the footer). */
  function revealFocused() {
    const input = focusedInput();
    if (!input || !body.current || !scroller.current) return;
    measure(input, (iy, ih) =>
      measure(body.current, (by, bh) => {
        const top = by + FIELD_MARGIN;
        const bottom = by + bh - FIELD_MARGIN;
        let dy = 0;
        if (iy + ih > bottom) dy = Math.min(iy + ih - bottom, iy - top); // a tall field shows its top
        else if (iy < top) dy = iy - top;
        if (Math.abs(dy) > 1) scroller.current?.scrollTo({ y: Math.max(0, scrollY.current + dy), animated: true });
      }),
    );
  }

  // After the keyboard (or the padding) moves, and whenever focus moves to another field while it's up.
  useEffect(() => {
    if (!up || !scroll) return;
    const t = setTimeout(revealFocused, 280);
    let last = focusedInput();
    const poll = setInterval(() => {
      const now = focusedInput();
      if (now && now !== last) revealFocused();
      last = now;
    }, 250);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad, scroll]);

  const foot = typeof footer === "function" ? footer(up) : footer;
  const head = typeof header === "function" ? header(up) : header;
  return (
    <View ref={outer} style={{ flex: 1, paddingBottom: pad }} testID="keyboard-screen">
      {head}
      <View ref={body} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            ref={scroller}
            contentContainerStyle={contentContainerStyle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            scrollEventThrottle={16}
            onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentContainerStyle]}>{children}</View>
        )}
      </View>
      {foot ? <View style={[{ paddingHorizontal: 24, paddingTop: up ? 10 : 16, paddingBottom: up ? 10 : 24, gap: up ? 2 : 8 }, typeof footerStyle === "function" ? footerStyle(up) : footerStyle]}>{foot}</View> : null}
    </View>
  );
}
