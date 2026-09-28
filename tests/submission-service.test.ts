import { describe, expect, it, vi } from "vitest";
import { destinationPoint, type GeofenceConfig } from "@/lib/geo";
import { processSubmission, type SubmissionDeps } from "@/lib/submission-service";
import type { NewSubmission, Submission } from "@/types/submission";

const TARGET = { latitude: 8.54612616725849, longitude: 76.90465781805145 };
const GEOFENCE: GeofenceConfig = { target: TARGET, radiusMeters: 100 };
const NOW = Date.UTC(2026, 8, 28, 13, 54);

function setup() {
  const insert = vi.fn(async (s: NewSubmission): Promise<Submission> => {
    const rest: Omit<NewSubmission, "ipHash"> & { ipHash?: string | null } = { ...s };
    delete rest.ipHash;
    return { ...rest, id: "00000000-0000-4000-8000-000000000001", createdAt: new Date(NOW) };
  });
  const deps: SubmissionDeps = { geofence: GEOFENCE, lowAccuracyThreshold: 50, insert, now: () => NOW };
  return { insert, deps };
}

const meta = { userAgent: "vitest", ipHash: "abc" };

function body(overrides: Record<string, unknown> = {}) {
  const p = destinationPoint(TARGET, 43.7, 10);
  return {
    name: "John Doe",
    department: "Computer Science",
    memberId: "CS2026001",
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: 12,
    positionTimestamp: NOW - 5_000,
    clientDistanceMeters: 43.7,
    ...overrides,
  };
}

describe("processSubmission — server-side validation & verification", () => {
  it("accepts a valid submission and computes distance/status on the server", async () => {
    const { insert, deps } = setup();
    const res = await processSubmission(body(), meta, deps);

    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
    const saved = insert.mock.calls[0][0];
    expect(saved.distanceM).toBeCloseTo(43.7, 1);
    expect(saved.geofenceStatus).toBe("WITHIN_RANGE");
    expect(saved.lowAccuracy).toBe(false);
    expect(saved.targetLatitude).toBe(TARGET.latitude);
    expect(saved.radiusM).toBe(100);
  });

  it("ignores a forged status/distance sent by the client", async () => {
    const { insert, deps } = setup();
    const far = destinationPoint(TARGET, 412.8, 250);
    const res = await processSubmission(
      body({
        latitude: far.latitude,
        longitude: far.longitude,
        clientDistanceMeters: 5, // lie
        geofenceStatus: "WITHIN_RANGE", // lie (not part of the schema — stripped)
        status: "WITHIN_RANGE",
        distanceM: 1,
      }),
      meta,
      deps,
    );

    expect(res.ok).toBe(true);
    const saved = insert.mock.calls[0][0];
    expect(saved.geofenceStatus).toBe("OUTSIDE_RANGE");
    expect(saved.distanceM).toBeCloseTo(412.8, 1);
    expect(saved.clientDistanceM).toBe(5); // kept only as an audit trail
  });

  it("flags low-accuracy fixes but still classifies by distance", async () => {
    const { insert, deps } = setup();
    await processSubmission(body({ accuracy: 180 }), meta, deps);
    const saved = insert.mock.calls[0][0];
    expect(saved.lowAccuracy).toBe(true);
    expect(saved.geofenceStatus).toBe("WITHIN_RANGE");
  });

  it.each([
    ["latitude above 90", { latitude: 90.5 }, "latitude"],
    ["latitude below -90", { latitude: -91 }, "latitude"],
    ["longitude above 180", { longitude: 181 }, "longitude"],
    ["longitude below -180", { longitude: -180.01 }, "longitude"],
    ["latitude as string", { latitude: "8.54" }, "latitude"],
    ["missing longitude", { longitude: undefined }, "longitude"],
    ["negative accuracy", { accuracy: -1 }, "accuracy"],
  ])("rejects invalid coordinates: %s", async (_label, overrides, field) => {
    const { insert, deps } = setup();
    const res = await processSubmission(body(overrides), meta, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.fieldErrors[field]).toBeTruthy();
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["empty name", { name: "   " }, "name"],
    ["one-letter name", { name: "J" }, "name"],
    ["name with digits/markup", { name: "<script>1</script>" }, "name"],
    ["missing department", { department: "" }, "department"],
    ["too-long department", { department: "x".repeat(101) }, "department"],
    ["missing ID", { memberId: "" }, "memberId"],
    ["ID with spaces/symbols", { memberId: "CS 2026; DROP" }, "memberId"],
  ])("rejects invalid fields: %s", async (_label, overrides, field) => {
    const { insert, deps } = setup();
    const res = await processSubmission(body(overrides), meta, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors[field]).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects non-object bodies", async () => {
    const { deps } = setup();
    for (const b of [null, "hello", 42, []]) {
      expect((await processSubmission(b, meta, deps)).ok).toBe(false);
    }
  });

  it("rejects stale or future-dated GPS fixes", async () => {
    const { insert, deps } = setup();
    expect((await processSubmission(body({ positionTimestamp: NOW - 11 * 60_000 }), meta, deps)).ok).toBe(false);
    expect((await processSubmission(body({ positionTimestamp: NOW + 5 * 60_000 }), meta, deps)).ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("normalizes whitespace in text fields", async () => {
    const { insert, deps } = setup();
    await processSubmission(body({ name: "  John   Doe ", department: " Computer\tScience " }), meta, deps);
    const saved = insert.mock.calls[0][0];
    expect(saved.name).toBe("John Doe");
    expect(saved.department).toBe("Computer Science");
  });
});
