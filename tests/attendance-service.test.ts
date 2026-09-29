import { describe, expect, it, vi } from "vitest";
import { checkIn, verifyLocation, VERIFICATION_TTL_S, type CheckInDeps } from "@/lib/attendance-service";
import { destinationPoint, type GeofenceConfig } from "@/lib/geo";
import { signToken } from "@/lib/signed-token";
import type { NewSubmission, Submission } from "@/types/submission";

// Workplace geofence
const TARGET = { latitude: 8.5458387, longitude: 76.9062601 }; // Principal, CET (OSM node 3695678553)
const GEOFENCE: GeofenceConfig = { target: TARGET, radiusMeters: 100 };
const SECRET = "unit-test-secret-that-is-longer-than-32-characters";
const NOW = Date.UTC(2026, 8, 29, 4, 30);

function deps(overrides: Partial<CheckInDeps> = {}) {
  const insert = vi.fn(async (s: NewSubmission): Promise<Submission> => {
    const row: Omit<NewSubmission, "ipHash"> & { ipHash?: string | null } = { ...s };
    delete row.ipHash;
    return { ...row, department: null, memberId: null, id: "00000000-0000-4000-8000-000000000001", createdAt: new Date(NOW) };
  });
  const d: CheckInDeps = {
    geofence: GEOFENCE,
    maxAccuracy: 150,
    lowAccuracyThreshold: 50,
    secret: SECRET,
    insert,
    now: () => NOW,
    ...overrides,
  };
  return { d, insert: (overrides.insert as typeof insert) ?? insert };
}

function fixAt(distance: number, bearing = 30, accuracy = 10) {
  const p = destinationPoint(TARGET, distance, bearing);
  return { latitude: p.latitude, longitude: p.longitude, accuracy, positionTimestamp: NOW - 3_000 };
}

const EMPLOYEE = {
  name: "Anita Menon",
  designation: "Assistant Professor",
  institution: "College of Engineering Trivandrum",
  email: "Anita.Menon@Example.com",
  mobile: "98765 43210",
};
const META = { userAgent: "vitest", ipHash: "abc" };

async function tokenFor(distance: number) {
  const { d } = deps();
  const r = await verifyLocation(fixAt(distance), d);
  if (!r.ok || !r.verificationToken) throw new Error("expected a verification token");
  return r.verificationToken;
}

describe("verifyLocation — server-side geofence check before the form is shown", () => {
  it("1. inside 100 m → WITHIN_RANGE with a verification token (form becomes available)", async () => {
    const r = await verifyLocation(fixAt(42.6), deps().d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toEqual({ distanceMeters: 42.6, status: "WITHIN_RANGE" });
    expect(r.verificationToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(r.expiresAt!.getTime()).toBe(Math.floor(NOW / 1000) * 1000 + VERIFICATION_TTL_S * 1000);
  });

  it("exactly at the workplace and on the 100 m boundary → WITHIN_RANGE", async () => {
    const at = await verifyLocation({ ...TARGET, accuracy: 5, positionTimestamp: NOW }, deps().d);
    expect(at.ok && at.result.status).toBe("WITHIN_RANGE");
    const edge = await verifyLocation(fixAt(100, 270), deps().d);
    expect(edge.ok && edge.result).toEqual({ distanceMeters: 100, status: "WITHIN_RANGE" });
  });

  it("2. outside 100 m → OUTSIDE_RANGE with distance and NO token (form blocked)", async () => {
    const r = await verifyLocation(fixAt(248.4), deps().d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toEqual({ distanceMeters: 248.4, status: "OUTSIDE_RANGE" });
    expect(r.verificationToken).toBeUndefined();
    expect((await verifyLocation(fixAt(100.02), deps().d)).ok && (await verifyLocation(fixAt(100.02), deps().d))).toMatchObject({
      result: { status: "OUTSIDE_RANGE" },
    });
  });

  it("measures from the Principal's office (OSM node 3695678553), not from earlier targets", async () => {
    const at = (latitude: number, longitude: number) => ({ latitude, longitude, accuracy: 5, positionTimestamp: NOW });
    // First target (Sept 28): ~180 m away → outside
    const first = await verifyLocation(at(8.54612616725849, 76.90465781805145), deps().d);
    expect(first.ok && first.result.status).toBe("OUTSIDE_RANGE");
    expect(first.ok && first.result.distanceMeters).toBeGreaterThan(150);
    // Previous target (Sept 29): 34.72 m from the Principal's office → inside
    const previous = await verifyLocation(at(8.546013910592666, 76.90652146747094), deps().d);
    expect(previous.ok && previous.result).toEqual({ distanceMeters: 34.72, status: "WITHIN_RANGE" });
  });

  it.each([
    ["latitude > 90", { latitude: 91 }],
    ["longitude < -180", { longitude: -181 }],
    ["latitude as string", { latitude: "8.5" }],
    ["NaN accuracy", { accuracy: Number.NaN }],
    ["missing timestamp", { positionTimestamp: undefined }],
  ])("rejects invalid location data: %s", async (_label, override) => {
    const r = await verifyLocation({ ...fixAt(10), ...override }, deps().d);
    expect(r).toMatchObject({ ok: false, status: 400, code: "INVALID" });
  });

  it("rejects poor / insufficient accuracy", async () => {
    const r = await verifyLocation(fixAt(10, 0, 500), deps().d);
    expect(r).toMatchObject({ ok: false, code: "POOR_ACCURACY" });
  });

  it("rejects stale or future-dated GPS fixes", async () => {
    const stale = await verifyLocation({ ...fixAt(10), positionTimestamp: NOW - 3 * 60_000 }, deps().d);
    const future = await verifyLocation({ ...fixAt(10), positionTimestamp: NOW + 3 * 60_000 }, deps().d);
    expect(stale).toMatchObject({ ok: false, code: "STALE_FIX" });
    expect(future).toMatchObject({ ok: false, code: "STALE_FIX" });
  });
});

describe("checkIn — authoritative server-side re-check and storage", () => {
  it("6. stores a check-in with server-computed distance and normalized details", async () => {
    const { d, insert } = deps();
    const r = await checkIn({ ...EMPLOYEE, verificationToken: await tokenFor(42.6) }, META, d);
    expect(r.ok).toBe(true);
    const saved = insert.mock.calls[0][0];
    expect(saved).toMatchObject({
      name: "Anita Menon",
      designation: "Assistant Professor",
      institution: "College of Engineering Trivandrum",
      email: "anita.menon@example.com",
      mobile: "+919876543210",
      distanceM: 42.6,
      geofenceStatus: "WITHIN_RANGE",
      targetLatitude: TARGET.latitude,
      targetLongitude: TARGET.longitude,
      radiusM: 100,
      clientDistanceM: null,
    });
    expect(saved.verificationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("7. direct submission without a location verification is refused", async () => {
    const { d, insert } = deps();
    const r = await checkIn({ ...EMPLOYEE }, META, d);
    expect(r).toMatchObject({ ok: false, status: 401, code: "VERIFICATION_REQUIRED" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("8. ignores client-supplied distance/status and forged coordinates", async () => {
    const { d, insert } = deps();
    const far = fixAt(412.8);
    const r = await checkIn(
      {
        ...EMPLOYEE,
        verificationToken: await tokenFor(10),
        distanceMeters: 0,
        geofenceStatus: "WITHIN_RANGE",
        status: "WITHIN_RANGE",
        latitude: far.latitude, // not accepted — coordinates only come from the signed verification
        longitude: far.longitude,
      },
      META,
      d,
    );
    expect(r.ok).toBe(true);
    expect(insert.mock.calls[0][0].distanceM).toBe(10);
  });

  it("8. rejects a verification token whose coordinates were tampered with", async () => {
    const { d, insert } = deps();
    const token = await tokenFor(10);
    const [body, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    const moved = Buffer.from(JSON.stringify({ ...claims, lat: claims.lat + 0.01 })).toString("base64url");
    const r = await checkIn({ ...EMPLOYEE, verificationToken: `${moved}.${sig}` }, META, d);
    expect(r).toMatchObject({ ok: false, status: 401, code: "VERIFICATION_REQUIRED" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("8. rejects tokens signed with another key, or admin-session-shaped tokens", async () => {
    const { d } = deps();
    const foreign = await signToken({ typ: "attendance-location", jti: crypto.randomUUID(), lat: TARGET.latitude, lon: TARGET.longitude, acc: 5, ts: NOW, iat: NOW / 1000, exp: NOW / 1000 + 600 }, "some-other-secret-of-sufficient-length!!");
    const session = await signToken({ sub: "admin", iat: NOW / 1000, exp: NOW / 1000 + 600 }, SECRET);
    for (const verificationToken of [foreign, session, "garbage", "a.b.c"]) {
      expect(await checkIn({ ...EMPLOYEE, verificationToken }, META, d)).toMatchObject({ ok: false, code: "VERIFICATION_REQUIRED" });
    }
  });

  it("rejects an expired verification", async () => {
    const token = await tokenFor(10);
    const { d } = deps({ now: () => NOW + (VERIFICATION_TTL_S + 1) * 1000 });
    expect(await checkIn({ ...EMPLOYEE, verificationToken: token }, META, d)).toMatchObject({ ok: false, code: "VERIFICATION_REQUIRED" });
  });

  it("re-computes against the CURRENT workplace: if the geofence moved, a prior verification no longer passes", async () => {
    const token = await tokenFor(90);
    const moved: GeofenceConfig = { target: destinationPoint(TARGET, 150, 210), radiusMeters: 100 };
    const { d, insert } = deps({ geofence: moved });
    const r = await checkIn({ ...EMPLOYEE, verificationToken: token }, META, d);
    expect(r).toMatchObject({ ok: false, status: 403, code: "OUTSIDE_RANGE" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("one verification = one check-in (unique violation → ALREADY_USED)", async () => {
    const insert = vi.fn(async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });
    const { d } = deps({ insert });
    const r = await checkIn({ ...EMPLOYEE, verificationToken: await tokenFor(10) }, META, d);
    expect(r).toMatchObject({ ok: false, status: 409, code: "ALREADY_USED" });
  });

  it.each([
    ["missing name", { name: "" }, "name"],
    ["name with digits", { name: "Agent 007" }, "name"],
    ["missing designation", { designation: " " }, "designation"],
    ["missing institution", { institution: "" }, "institution"],
    ["invalid email", { email: "anita@" }, "email"],
    ["email without domain dot", { email: "not-an-email" }, "email"],
    ["missing mobile", { mobile: "" }, "mobile"],
    ["short mobile", { mobile: "12345" }, "mobile"],
    ["Indian mobile starting with 5", { mobile: "5876543210" }, "mobile"],
    ["letters in mobile", { mobile: "98765abcde" }, "mobile"],
  ])("5. rejects invalid form data: %s", async (_label, override, field) => {
    const { d, insert } = deps();
    const r = await checkIn({ ...EMPLOYEE, ...override, verificationToken: await tokenFor(10) }, META, d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.fieldErrors?.[field]).toBeTruthy();
    }
    expect(insert).not.toHaveBeenCalled();
  });
});
