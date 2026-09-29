import { describe, expect, it } from "vitest";
import { destinationPoint, evaluateGeofence, haversineDistance, type GeofenceConfig } from "@/lib/geo";

const TARGET = { latitude: 8.546013910592666, longitude: 76.90652146747094 };
const CONFIG: GeofenceConfig = { target: TARGET, radiusMeters: 100 };

describe("haversineDistance", () => {
  it("is zero for identical points", () => {
    expect(haversineDistance(TARGET, TARGET)).toBe(0);
  });

  it("matches a known reference distance (1° of latitude ≈ 111.195 km)", () => {
    const d = haversineDistance({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeCloseTo(111_195, -1);
  });

  it("is symmetric", () => {
    const other = { latitude: 8.5471, longitude: 76.9052 };
    expect(haversineDistance(TARGET, other)).toBeCloseTo(haversineDistance(other, TARGET), 9);
  });

  it("round-trips with destinationPoint in every direction", () => {
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const p = destinationPoint(TARGET, 75, bearing);
      expect(haversineDistance(TARGET, p)).toBeCloseTo(75, 6);
    }
  });
});

describe("evaluateGeofence (100 m radius around the configured target)", () => {
  it("Case 1: user exactly at the target → WITHIN_RANGE", () => {
    expect(evaluateGeofence(TARGET, CONFIG)).toEqual({ distanceMeters: 0, status: "WITHIN_RANGE" });
  });

  it("Case 2: user ~50 m away → WITHIN_RANGE", () => {
    const r = evaluateGeofence(destinationPoint(TARGET, 50, 60), CONFIG);
    expect(r.distanceMeters).toBeCloseTo(50, 1);
    expect(r.status).toBe("WITHIN_RANGE");
  });

  it("Case 3: user ~100 m away (on the boundary) → WITHIN_RANGE", () => {
    for (const bearing of [0, 90, 180, 270]) {
      const r = evaluateGeofence(destinationPoint(TARGET, 100, bearing), CONFIG);
      expect(r.distanceMeters).toBe(100);
      expect(r.status).toBe("WITHIN_RANGE");
    }
    expect(evaluateGeofence(destinationPoint(TARGET, 99.9, 30), CONFIG).status).toBe("WITHIN_RANGE");
  });

  it("Case 4: user more than 100 m away → OUTSIDE_RANGE", () => {
    expect(evaluateGeofence(destinationPoint(TARGET, 100.02, 0), CONFIG).status).toBe("OUTSIDE_RANGE");
    expect(evaluateGeofence(destinationPoint(TARGET, 101, 200), CONFIG).status).toBe("OUTSIDE_RANGE");

    const far = evaluateGeofence(destinationPoint(TARGET, 287.4, 120), CONFIG);
    expect(far.distanceMeters).toBeCloseTo(287.4, 1);
    expect(far.status).toBe("OUTSIDE_RANGE");
  });

  it("Case 5: invalid latitude/longitude → validation error", () => {
    expect(() => evaluateGeofence({ latitude: 91, longitude: 76.9 }, CONFIG)).toThrow(RangeError);
    expect(() => evaluateGeofence({ latitude: -90.0001, longitude: 76.9 }, CONFIG)).toThrow(/latitude/i);
    expect(() => evaluateGeofence({ latitude: 8.5, longitude: 180.5 }, CONFIG)).toThrow(/longitude/i);
    expect(() => evaluateGeofence({ latitude: Number.NaN, longitude: 76.9 }, CONFIG)).toThrow(RangeError);
    expect(() => evaluateGeofence({ latitude: 8.5, longitude: Infinity }, CONFIG)).toThrow(RangeError);
  });

  it("respects a different configured radius", () => {
    const p = destinationPoint(TARGET, 150, 0);
    expect(evaluateGeofence(p, { ...CONFIG, radiusMeters: 200 }).status).toBe("WITHIN_RANGE");
    expect(evaluateGeofence(p, CONFIG).status).toBe("OUTSIDE_RANGE");
  });
});
