import { NextResponse, type NextRequest } from "next/server";
import { parseFilters } from "@/lib/admin-filters";
import { getAdminSession } from "@/lib/auth";
import { exportSubmissions } from "@/lib/db";

const COLUMNS = [
  ["id", "Reference"],
  ["createdAt", "Check-In Time (UTC)"],
  ["name", "Employee Name"],
  ["designation", "Designation"],
  ["institution", "Institution"],
  ["email", "Email"],
  ["mobile", "Mobile Number"],
  ["distanceM", "Distance (m)"],
  ["geofenceStatus", "Status"],
  ["latitude", "Latitude"],
  ["longitude", "Longitude"],
  ["accuracyM", "Accuracy (m)"],
  ["lowAccuracy", "Low Accuracy"],
  ["positionCapturedAt", "GPS Fix At (UTC)"],
  ["radiusM", "Radius (m)"],
  ["targetLatitude", "Target Latitude"],
  ["targetLongitude", "Target Longitude"],
  ["clientDistanceM", "Client-Reported Distance (m)"],
  ["verificationId", "Location Verification ID"],
  ["department", "Department (earlier registrations)"],
  ["memberId", "ID (earlier registrations)"],
] as const;

function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell)
  if (/^[=+\-@\t\r]/.test(s) && typeof value === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filters = parseFilters(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await exportSubmissions(filters);

  const lines = [
    COLUMNS.map(([, label]) => label).join(","),
    ...rows.map((r) => COLUMNS.map(([key]) => csvCell(r[key])).join(",")),
  ];
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="submissions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
