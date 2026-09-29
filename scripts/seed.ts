/**
 * Seed the LOCAL database with realistic, clearly fake attendance data for testing.
 *
 *   npm run db:seed                      # add 40 check-ins + 8 earlier-style registrations
 *   npm run db:seed -- --reset           # first remove previously seeded rows (only those)
 *   npm run db:seed -- --count=100       # a different number of check-ins
 *   npm run db:seed -- --remove          # only remove previously seeded rows, add nothing
 *
 * - Refuses to run against anything but a local database (localhost / docker `db`).
 * - Deterministic (fixed random seed): the same command always produces the same data.
 * - Every seeded row is tagged (user_agent = "seed-script", emails @example.com), so
 *   `--reset` removes seed data only and never touches real records.
 * - Distances/statuses are computed with the app's own geofence code against the
 *   configured TARGET_* location; employee details pass the app's own validation.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { connectionOptions, isLocalDatabase } from "../lib/db-options";
import { assertValidCoordinates, destinationPoint, evaluateGeofence, type GeofenceConfig } from "../lib/geo";
import { employeeSchema } from "../lib/validation";
import { loadEnv } from "./load-env";

loadEnv();

const SEED_TAG = "seed-script";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const REMOVE_ONLY = !!arg("remove");
const RESET = REMOVE_ONLY || !!arg("reset");
const countArg = Number(arg("count")?.split("=")[1] ?? 40);
const COUNT = Number.isFinite(countArg) ? Math.min(Math.max(Math.floor(countArg), 0), 1000) : 40;
const LEGACY_COUNT = 8;

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────
let state = 20260930;
function rand() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (min: number, max: number) => min + rand() * (max - min);

// ── fake people ─────────────────────────────────────────────────────────────
const FIRST = ["Anita", "Rahul", "Priya", "Arjun", "Meera", "Vishnu", "Lakshmi", "Arun", "Divya", "Hari",
  "Sneha", "Nikhil", "Aswathy", "Gokul", "Reshma", "Sanjay", "Fathima", "Joseph", "Nimisha", "Abdul"] as const;
const LAST = ["Menon", "Nair", "Pillai", "Kumar", "Varghese", "Thomas", "Krishnan", "Raj", "Suresh", "Mohan",
  "Das", "George", "Rahman", "Iyer", "Chandran"] as const;
const DESIGNATIONS = ["Assistant Professor", "Associate Professor", "Professor", "Lab Assistant", "Research Scholar",
  "Technical Officer", "Office Assistant", "Librarian", "Head of Dept., CSE", "Guest Lecturer"] as const;
const INSTITUTIONS = ["College of Engineering Trivandrum", "Government Engineering College, Barton Hill",
  "University of Kerala", "Sree Chitra Thirunal College of Engineering", "Mar Baselios College of Engineering and Technology"] as const;
const DEPARTMENTS = ["Computer Science", "Electronics", "Mechanical", "Civil", "Electrical"] as const;

function geofenceFromEnv(): GeofenceConfig {
  const target = { latitude: Number(process.env.TARGET_LATITUDE), longitude: Number(process.env.TARGET_LONGITUDE) };
  assertValidCoordinates(target);
  return { target, radiusMeters: Number(process.env.GEOFENCE_RADIUS_METERS || 100) };
}

/** A morning `daysBack` days ago, between 08:30 and 10:45 IST. */
function morning(daysBack: number): Date {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  const istMinutes = 8 * 60 + 30 + Math.floor(rand() * 135);
  // IST = UTC+5:30 → UTC minutes = IST minutes − 330
  d.setUTCHours(0, istMinutes - 330, Math.floor(rand() * 60), 0);
  return d;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (add it to .env.local).");
  if (!isLocalDatabase(url)) {
    throw new Error(`Refusing to seed ${new URL(url).hostname}: test data is only allowed in a local database.`);
  }
  const geofence = geofenceFromEnv();
  const sql = postgres(url, { ...connectionOptions(url), max: 1, onnotice: () => {} });

  try {
    if (RESET) {
      const removed = await sql`DELETE FROM submissions WHERE user_agent = ${SEED_TAG} RETURNING verification_id`;
      const ids = removed.map((r) => r.verification_id).filter(Boolean);
      if (ids.length) await sql`DELETE FROM used_verifications WHERE verification_id = ANY(${ids}::uuid[])`;
      console.log(`Removed ${removed.length} previously seeded row(s).`);
      if (REMOVE_ONLY) return;
    }

    const usedEmails = new Set<string>();
    let within = 0, lowAcc = 0;

    // Check-ins (the current QR flow): always within the geofence
    for (let i = 0; i < COUNT; i++) {
      const first = pick(FIRST), last = pick(LAST);
      let email = `${first}.${last}`.toLowerCase() + "@example.com";
      for (let k = 2; usedEmails.has(email); k++) email = `${first}.${last}${k}`.toLowerCase() + "@example.com";
      usedEmails.add(email);

      const details = employeeSchema.parse({
        name: `${first} ${last}`,
        designation: pick(DESIGNATIONS),
        institution: pick(INSTITUTIONS),
        email,
        mobile: `90000 ${String(10000 + i).padStart(5, "0")}`, // obviously fake 90000-xxxxx numbers
      });

      // Mostly well inside; a few near the 100 m edge; ~15% with poor (but acceptable) accuracy
      const radius = geofence.radiusMeters;
      const dist = rand() < 0.12 ? between(radius * 0.9, radius * 0.99) : between(3, radius * 0.85);
      const pos = destinationPoint(geofence.target, dist, between(0, 360));
      const accuracy = rand() < 0.15 ? between(55, 140) : between(4, 30);
      const { distanceMeters, status } = evaluateGeofence(pos, geofence);
      if (status !== "WITHIN_RANGE") continue; // (can't happen with dist < radius; defensive)

      const createdAt = morning(Math.floor(rand() * 7));
      const verificationId = randomUUID();
      await sql.begin(async (tx) => {
        await tx`INSERT INTO used_verifications (verification_id, expires_at, used_at)
                 VALUES (${verificationId}, ${new Date(createdAt.getTime() + 600_000)}, ${createdAt})`;
        await tx`
          INSERT INTO submissions (
            name, designation, institution, email, mobile, latitude, longitude, accuracy_m,
            position_captured_at, distance_m, geofence_status, low_accuracy,
            target_latitude, target_longitude, radius_m, verification_id, user_agent, ip_hash, created_at
          ) VALUES (
            ${details.name}, ${details.designation}, ${details.institution}, ${details.email}, ${details.mobile},
            ${pos.latitude}, ${pos.longitude}, ${Math.round(accuracy * 10) / 10},
            ${new Date(createdAt.getTime() - between(20, 90) * 1000)}, ${distanceMeters}, ${status}, ${accuracy > 50},
            ${geofence.target.latitude}, ${geofence.target.longitude}, ${radius}, ${verificationId},
            ${SEED_TAG}, 'seed', ${createdAt}
          )`;
      });
      within++;
      if (accuracy > 50) lowAcc++;
    }

    // Earlier-style registrations (department + ID), including OUTSIDE_RANGE ones,
    // so the status filter, red map markers and legacy display have data too.
    let outside = 0;
    for (let i = 0; i < LEGACY_COUNT; i++) {
      const isOutside = i % 2 === 0;
      const dist = isOutside ? between(geofence.radiusMeters * 1.2, 650) : between(10, geofence.radiusMeters * 0.8);
      const pos = destinationPoint(geofence.target, dist, between(0, 360));
      const { distanceMeters, status } = evaluateGeofence(pos, geofence);
      const createdAt = morning(8 + Math.floor(rand() * 5));
      const dept = pick(DEPARTMENTS);
      await sql`
        INSERT INTO submissions (
          name, department, member_id, latitude, longitude, accuracy_m, position_captured_at,
          distance_m, geofence_status, low_accuracy, target_latitude, target_longitude, radius_m,
          user_agent, ip_hash, created_at
        ) VALUES (
          ${`${pick(FIRST)} ${pick(LAST)}`}, ${dept}, ${`${dept.slice(0, 2).toUpperCase()}2026${String(100 + i)}`},
          ${pos.latitude}, ${pos.longitude}, ${Math.round(between(5, 40) * 10) / 10}, ${createdAt},
          ${distanceMeters}, ${status}, false, ${geofence.target.latitude}, ${geofence.target.longitude},
          ${geofence.radiusMeters}, ${SEED_TAG}, 'seed', ${createdAt}
        )`;
      if (status === "OUTSIDE_RANGE") outside++;
    }

    const [{ total }] = await sql`SELECT count(*)::int AS total FROM submissions`;
    console.log(
      `✓ Seeded ${within} check-ins (${lowAcc} flagged low-accuracy) and ${LEGACY_COUNT} earlier-style registrations ` +
        `(${outside} outside the geofence) around ${geofence.target.latitude}, ${geofence.target.longitude}.`,
    );
    console.log(`  submissions table now has ${total} row(s). Remove seed data with: npm run db:seed -- --remove`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ Seeding failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
