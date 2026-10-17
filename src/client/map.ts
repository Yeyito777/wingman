// Live map: the person, their buddies and the venue. OSM tiles (darkened in CSS); markers are pure CSS (no image assets).

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SessionView } from "../shared/types.ts";
import { esc } from "./common.ts";

export function createMap(el: HTMLElement) {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([43.7845, -79.1875], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  let user: L.Marker | null = null;
  let acc: L.Circle | null = null;
  let venue: L.Circle | null = null;
  let link: L.Polyline | null = null;
  const buddies = new Map<string, L.Marker>();
  let fitted = false;

  const icon = (cls: string) => L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

  return {
    update(v: SessionView) {
      const pts: L.LatLngExpression[] = [];
      if (v.venue) {
        const ll: L.LatLngExpression = [v.venue.lat, v.venue.lng];
        venue ??= L.circle(ll, { radius: 60, color: "#38bdf8", weight: 1, fillOpacity: 0.12 }).addTo(map).bindTooltip(v.demo ? "Group" : "Venue", { permanent: true, direction: "top", className: "pin-label" });
        venue.setLatLng(ll);
        pts.push(ll);
      }
      if (v.fix) {
        const ll: L.LatLngExpression = [v.fix.lat, v.fix.lng];
        const cls = `user ${v.stage > 0 ? "alert" : ""}`;
        if (!user) user = L.marker(ll, { icon: icon(cls), zIndexOffset: 1000 }).addTo(map).bindTooltip(esc(v.user.name), { permanent: true, direction: "right", offset: [12, 0], className: "pin-label" });
        user.setLatLng(ll).setIcon(icon(cls));
        acc ??= L.circle(ll, { radius: 10, color: "#8b5cf6", weight: 1, fillOpacity: 0.1 }).addTo(map);
        acc.setLatLng(ll).setRadius(Math.min(v.fix.accuracy, 300));
        pts.push(ll);
        if (v.venue && (v.distanceFromGroupM ?? 0) > 50) {
          const path: L.LatLngExpression[] = [[v.venue.lat, v.venue.lng], ll];
          link ??= L.polyline(path, { color: "#ef4444", weight: 3, dashArray: "6 8" }).addTo(map);
          link.setLatLngs(path);
        } else if (link) {
          link.remove();
          link = null;
        }
      } else if (user) {
        user.remove();
        acc?.remove();
        user = null;
        acc = null;
      }
      for (const b of v.buddies) {
        if (!b.fix || v.demo) continue;
        const ll: L.LatLngExpression = [b.fix.lat, b.fix.lng];
        let m = buddies.get(b.id);
        if (!m) {
          m = L.marker(ll, { icon: icon("buddy") }).addTo(map).bindTooltip(esc(b.name), { permanent: true, direction: "left", offset: [-10, 0], className: "pin-label" });
          buddies.set(b.id, m);
        }
        m.setLatLng(ll);
        pts.push(ll);
      }
      if (pts.length && (!fitted || v.signals.walking || v.stage > 0)) {
        if (pts.length === 1) map.setView(pts[0]!, 17, { animate: fitted });
        else map.fitBounds(L.latLngBounds(pts).pad(0.5), { maxZoom: 17, animate: fitted });
        fitted = true;
      }
    },
    invalidate() {
      map.invalidateSize();
    },
  };
}
