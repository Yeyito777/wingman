// Live group map: every member as a coloured pin, members in alert pulse red with a dashed line to their nearest
// friend. OSM tiles (darkened in CSS); markers are pure CSS (no image assets).

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GroupView } from "../shared/types.ts";
import { esc } from "./common.ts";

export function createMap(el: HTMLElement) {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([43.7845, -79.1875], 17);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const pins = new Map<string, L.Marker>();
  const links = new Map<string, L.Polyline>();
  /** coarse fixes (e.g. iOS "approximate location") get a translucent accuracy circle */
  const rings = new Map<string, L.Circle>();
  let fitted = false;
  let lastKey = "";

  const icon = (color: string, alert: boolean, initial: string) =>
    L.divIcon({ className: "", html: `<div class="mpin ${alert ? "alert" : ""}" style="--c:${color}">${esc(initial)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });

  return {
    update(v: GroupView) {
      const pts: L.LatLngExpression[] = [];
      const seen = new Set<string>();
      for (const m of v.members) {
        if (!m.fix) continue;
        seen.add(m.id);
        const ll: L.LatLngExpression = [m.fix.lat, m.fix.lng];
        const alert = !!m.alert;
        let p = pins.get(m.id);
        if (!p) {
          p = L.marker(ll, { zIndexOffset: 500 }).addTo(map).bindTooltip(esc(m.name), { permanent: true, direction: "right", offset: [16, 0], className: "pin-label" });
          pins.set(m.id, p);
        }
        p.setLatLng(ll).setIcon(icon(alert ? "#ef4444" : m.color, alert, m.name.charAt(0).toUpperCase())).setZIndexOffset(alert ? 1000 : 500);
        pts.push(ll);
        let ring = rings.get(m.id);
        if (m.fix.accuracy > 150) {
          if (!ring) rings.set(m.id, (ring = L.circle(ll, { radius: m.fix.accuracy, color: m.color, weight: 1, opacity: 0.5, fillOpacity: 0.08, interactive: false }).addTo(map)));
          ring.setLatLng(ll).setRadius(m.fix.accuracy);
        } else if (ring) {
          ring.remove();
          rings.delete(m.id);
        }
        const near = m.nearestMemberId ? v.members.find((x) => x.id === m.nearestMemberId)?.fix : null;
        const far = (m.distanceFromGroupM ?? 0) > 50 && near;
        let line = links.get(m.id);
        if (far) {
          const path: L.LatLngExpression[] = [[near.lat, near.lng], ll];
          if (!line) links.set(m.id, (line = L.polyline(path, { color: "#ef4444", weight: 3, dashArray: "6 8" }).addTo(map)));
          line.setLatLngs(path);
        } else if (line) {
          line.remove();
          links.delete(m.id);
        }
      }
      for (const [id, p] of pins) if (!seen.has(id)) (p.remove(), pins.delete(id), links.get(id)?.remove(), links.delete(id), rings.get(id)?.remove(), rings.delete(id));
      // Re-fit when who's on the map changes, the set of far-away / alerting members changes, someone is walking, or
      // a pin left the visible area (e.g. a phone 30 km from where the map started, or everyone moving to it).
      const key = v.members.map((m) => `${m.id}:${m.fix ? 1 : 0}:${(m.distanceFromGroupM ?? 0) > 50 ? 1 : 0}:${m.alert ? 1 : 0}`).join("|");
      const moving = v.members.some((m) => (m.distanceFromGroupM ?? 0) > 50);
      const view = map.getBounds();
      const outside = fitted && pts.some((p) => !view.contains(p));
      if (pts.length && (!fitted || key !== lastKey || moving || outside)) {
        if (pts.length === 1) map.setView(pts[0]!, 17, { animate: fitted });
        else map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 18, animate: fitted });
        fitted = true;
        lastKey = key;
      }
    },
    invalidate() {
      map.invalidateSize();
    },
  };
}
