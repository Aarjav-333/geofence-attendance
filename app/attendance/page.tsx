import type { Metadata } from "next";
import { AttendanceClosed } from "@/components/attendance/attendance-closed";
import { AttendanceFlow } from "@/components/attendance/attendance-flow";
import { getGeofenceConfig } from "@/lib/config";
import { getAttendanceStatus } from "@/lib/db";

export const metadata: Metadata = { title: "Workplace Attendance" };

// Read env at request time so changing the workplace never requires a rebuild.
export const dynamic = "force-dynamic";

/**
 * Entry point opened by the workplace QR code. The page only knows the radius;
 * the workplace coordinates and every geofence decision stay on the server.
 */
export default async function AttendancePage() {
  const { radiusMeters } = getGeofenceConfig();
  // Admin switch (checked on every request). If the setting can't be read (e.g. a brief DB
  // outage), show the normal flow rather than an error page — the API enforces the switch.
  const open = await getAttendanceStatus()
    .then((s) => s.open)
    .catch((err) => {
      console.error("[attendance] could not read attendance status; showing the flow", err);
      return true;
    });

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-8 sm:py-14">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Workplace Attendance</h1>
        {open && <p className="mt-1.5 text-muted">Verify your location, then check in.</p>}
      </header>

      {open ? (
        <>
          <AttendanceFlow radiusMeters={radiusMeters} />
          <footer className="mt-8 text-center text-xs leading-relaxed text-muted">
            Your location is read once, only when you tap “Detect My Location”, to verify you are within{" "}
            {radiusMeters} m of the workplace. It is stored with your check-in for attendance auditing and is not
            tracked afterwards.
          </footer>
        </>
      ) : (
        <AttendanceClosed retryHref="/attendance" />
      )}
    </main>
  );
}
