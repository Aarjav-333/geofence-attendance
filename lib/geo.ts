/**
 * Geographic distance + geofence classification.
 *
 * Pure functions only — shared by the browser (instant feedback) and the
 * server (authoritative verification), so both sides compute identically.
 */

/** Mean Earth radius in meters (IUGG). */
export const EARTH_RADIUS_M = 6_371_008.8;

export type GeofenceStatus = "WITHIN_RANGE" | "OUTSIDE_RANGE";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeofenceConfig {
  target: Coordinates;
  radiusMeters: number;
}

export interface GeofenceResult {
  /** Great-circle distance to the target, rounded to centimeters. */
  distanceMeters: number;
  status: GeofenceStatus;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function isValidLatitude(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
}

export function assertValidCoordinates(c: Coordinates): void {
  if (!isValidLatitude(c.latitude)) {
    throw new RangeError(`Invalid latitude: ${c.latitude} (must be between -90 and 90)`);
  }
  if (!isValidLongitude(c.longitude)) {
    throw new RangeError(`Invalid longitude: ${c.longitude} (must be between -180 and 180)`);
  }
}

/**
 * Haversine great-circle distance in meters.
 *
 *   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
 *   d = 2R · atan2(√a, √(1−a))
 *
 * Accurate to ~0.3% worldwide (spherical-Earth model) and far better than
 * that at the ~100 m scale this app cares about.
 */
export function haversineDistance(a: Coordinates, b: Coordinates): number {
  assertValidCoordinates(a);
  assertValidCoordinates(b);

  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const Δφ = toRad(b.latitude - a.latitude);
  const Δλ = toRad(b.longitude - a.longitude);

  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Point reached by travelling `distanceMeters` from `origin` on initial
 * `bearingDeg` (0 = north, 90 = east). Inverse of the haversine distance;
 * used by tests and the admin map.
 */
export function destinationPoint(origin: Coordinates, distanceMeters: number, bearingDeg: number): Coordinates {
  const δ = distanceMeters / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin.latitude);
  const λ1 = toRad(origin.longitude);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return { latitude: toDeg(φ2), longitude: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Round to centimeter precision so the boundary comparison is deterministic. */
export function roundDistance(meters: number): number {
  return Math.round(meters * 100) / 100;
}

/** Classify a position against the geofence. distance <= radius → WITHIN_RANGE. */
export function evaluateGeofence(position: Coordinates, config: GeofenceConfig): GeofenceResult {
  const distanceMeters = roundDistance(haversineDistance(position, config.target));
  return {
    distanceMeters,
    status: distanceMeters <= config.radiusMeters ? "WITHIN_RANGE" : "OUTSIDE_RANGE",
  };
}

export function formatDistance(meters: number): string {
  if (meters >= 10_000) return `${(meters / 1000).toFixed(1)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}
