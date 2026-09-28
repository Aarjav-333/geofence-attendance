"use client";

import "leaflet/dist/leaflet.css";
import { latLngBounds } from "leaflet";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { formatDistance, type Coordinates, type GeofenceStatus } from "@/lib/geo";

export interface MapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  distanceM: number;
  status: GeofenceStatus;
}

interface Props {
  target: Coordinates;
  radiusMeters: number;
  points: MapPoint[];
}

const OK = "#0f9d58";
const BAD = "#d93025";
const TARGET = "#1f5eff";

export default function SubmissionsMap({ target, radiusMeters, points }: Props) {
  // Fit the geofence plus the plotted submissions (ignore far outliers > 5 km so the fence stays readable)
  const near = points.filter((p) => p.distanceM <= 5000);
  const bounds = latLngBounds([[target.latitude, target.longitude]]);
  near.forEach((p) => bounds.extend([p.latitude, p.longitude]));
  const pad = Math.max(radiusMeters * 1.5, 50) / 111_320;
  bounds.extend([target.latitude + pad, target.longitude + pad]);
  bounds.extend([target.latitude - pad, target.longitude - pad]);

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border" aria-label="Map of submissions on this page">
      <MapContainer bounds={bounds} scrollWheelZoom={false} className="h-72 w-full sm:h-96">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Circle
          center={[target.latitude, target.longitude]}
          radius={radiusMeters}
          pathOptions={{ color: TARGET, weight: 2, fillOpacity: 0.08 }}
        >
          <Popup>
            Designated location · {radiusMeters} m radius
          </Popup>
        </Circle>
        <CircleMarker
          center={[target.latitude, target.longitude]}
          radius={4}
          pathOptions={{ color: TARGET, fillColor: TARGET, fillOpacity: 1 }}
        />
        {points.map((p) => {
          const color = p.status === "WITHIN_RANGE" ? OK : BAD;
          return (
            <CircleMarker
              key={p.id}
              center={[p.latitude, p.longitude]}
              radius={7}
              pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 }}
            >
              <Popup>
                <strong>{p.name}</strong>
                <br />
                {formatDistance(p.distanceM)} · {p.status}
                <br />
                accuracy ±{Math.round(p.accuracyM)} m
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="flex flex-wrap gap-4 border-t border-border bg-surface px-4 py-2 text-xs text-muted">
        <Legend color={TARGET} label={`Geofence (${radiusMeters} m)`} />
        <Legend color={OK} label="Within range" />
        <Legend color={BAD} label="Outside range" />
        <span className="ml-auto">Showing submissions on this page</span>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
