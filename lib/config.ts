import "server-only";
import { parseAdminAccounts, type AdminAccount } from "./admin-accounts";
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

/**
 * GPS fixes whose reported accuracy radius is larger than this are rejected as
 * insufficient: with ±300 m of uncertainty a 100 m geofence can't be judged.
 */
export function getMaxAccuracy(): number {
  const max = number("MAX_ACCURACY_METERS", 150);
  if (max <= 0) throw new Error("MAX_ACCURACY_METERS must be positive");
  return max;
}

/**
 * Public base URL of the app (used for the workplace QR code).
 * APP_URL wins; on Vercel the stable production domain is used; otherwise the
 * current request's host.
 */
export function getAppUrl(requestHeaders?: Headers): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd}`;
  const host = requestHeaders?.get("x-forwarded-host") ?? requestHeaders?.get("host") ?? "localhost:3000";
  const proto = requestHeaders?.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** IANA timezone used for "Today" and displayed timestamps in the admin dashboard. */
export function getDisplayTimezone(): string {
  return process.env.DISPLAY_TIMEZONE?.trim() || "Asia/Kolkata";
}

export function getDatabaseUrl(): string {
  return required("DATABASE_URL");
}

/** All administrator accounts (primary + ADDITIONAL_ADMINS), each with the "admin" role. */
export function getAdminAccounts(): AdminAccount[] {
  return parseAdminAccounts(process.env);
}

export function getSessionSecret(): string {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return secret;
}
