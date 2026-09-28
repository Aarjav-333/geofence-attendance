import "server-only";
import { assertValidCoordinates, type GeofenceConfig } from "./geo";

/**
 * Server-side configuration, read from environment variables.
 * The geofence target is defined ONLY here — nothing else hardcodes it.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function number(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  return n;
}

export function getGeofenceConfig(): GeofenceConfig {
  const target = { latitude: number("TARGET_LATITUDE"), longitude: number("TARGET_LONGITUDE") };
  assertValidCoordinates(target);
  const radiusMeters = number("GEOFENCE_RADIUS_METERS", 100);
  if (radiusMeters <= 0) throw new Error("GEOFENCE_RADIUS_METERS must be positive");
  return { target, radiusMeters };
}

export function getLowAccuracyThreshold(): number {
  return number("LOW_ACCURACY_THRESHOLD_METERS", 50);
}

export function getDepartmentSuggestions(): string[] {
  return (process.env.DEPARTMENTS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

/** IANA timezone used for "Today" and displayed timestamps in the admin dashboard. */
export function getDisplayTimezone(): string {
  return process.env.DISPLAY_TIMEZONE?.trim() || "Asia/Kolkata";
}

export function getDatabaseUrl(): string {
  return required("DATABASE_URL");
}

export function getAdminCredentials(): { username: string; passwordHash: string } {
  return { username: required("ADMIN_USERNAME"), passwordHash: required("ADMIN_PASSWORD_HASH") };
}

export function getSessionSecret(): string {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return secret;
}
