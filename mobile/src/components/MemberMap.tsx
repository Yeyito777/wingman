// Apple Maps with one pin per member (react-native-maps; works in Expo Go on iOS).

import type { MemberView } from "@shared/protocol";
import { useEffect, useRef } from "react";
import MapView, { Marker } from "react-native-maps";
import { Pin } from "./MemberMap.pin";

export function MemberMap({ members, focusId, style }: { members: MemberView[]; focusId?: string; style?: any }) {
  const ref = useRef<MapView>(null);
  const pts = members.filter((m) => m.fix);
  const key = pts.map((m) => `${m.id}:${m.fix!.lat.toFixed(4)},${m.fix!.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    const focus = pts.find((m) => m.id === focusId);
    const coords = (focus ? [focus, ...pts.filter((m) => m.isYou)] : pts).map((m) => ({ latitude: m.fix!.lat, longitude: m.fix!.lng }));
    if (!coords.length) return;
    const t = setTimeout(
      () => ref.current?.fitToCoordinates(coords, { edgePadding: { top: 80, right: 60, bottom: 80, left: 60 }, animated: true }),
      300,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focusId]);
  const first = pts[0]?.fix;
  return (
    <MapView
      ref={ref}
      style={[{ flex: 1 }, style]}
      userInterfaceStyle="dark"
      showsUserLocation={false}
      showsPointsOfInterests={false}
      initialRegion={first ? { latitude: first.lat, longitude: first.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 } : undefined}
    >
      {pts.map((m) => (
        <Marker key={m.id} coordinate={{ latitude: m.fix!.lat, longitude: m.fix!.lng }} title={m.isYou ? "You" : m.name} anchor={{ x: 0.5, y: 0.5 }}>
          <Pin m={m} />
        </Marker>
      ))}
    </MapView>
  );
}
