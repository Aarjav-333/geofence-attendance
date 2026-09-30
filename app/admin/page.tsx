import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceToggle } from "@/components/admin/attendance-toggle";
import { ClearAllData } from "@/components/admin/clear-all-data";
import { AdminFilters } from "@/components/admin/filters";
import { SubmissionsMap } from "@/components/admin/submissions-map-loader";
import { SubmissionsTable } from "@/components/admin/submissions-table";
import { filtersToSearch, parseFilters } from "@/lib/admin-filters";
import { requireAdmin } from "@/lib/auth";
import { getGeofenceConfig } from "@/lib/config";
import { formatDateTime } from "@/lib/datetime";
import { getAttendanceStatus, getLastClearAll, getStats, listInstitutions, listSubmissions } from "@/lib/db";
import { logout } from "./actions";

export const metadata: Metadata = { title: "Admin dashboard", robots: { index: false, follow: false } };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const session = await requireAdmin();
  const filters = parseFilters(await searchParams);
  const geofence = getGeofenceConfig();

  const [stats, institutions, result, lastClear, attendance] = await Promise.all([
    getStats(),
    listInstitutions(),
    listSubmissions(filters),
    // Optional line: if the audit table is unavailable (e.g. migration not yet applied),
    // the dashboard still renders — just without "Last cleared".
    getLastClearAll().catch((err) => {
      console.error("[admin] could not read the audit log", err);
      return null;
    }),
    // If the setting can't be read, show the switch in an "unknown" state instead of
    // failing the whole dashboard (the admin may need it to fix things).
    getAttendanceStatus().catch((err) => {
      console.error("[admin] could not read attendance status", err);
      return null;
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="text-sm text-muted">
            Workplace: {geofence.target.latitude.toFixed(6)}, {geofence.target.longitude.toFixed(6)} · radius{" "}
            {geofence.radiusMeters} m
          </p>
          {lastClear && (
            <p className="text-xs text-muted">
              Last cleared by {lastClear.actor} on {formatDateTime(lastClear.at)}
              {typeof lastClear.details?.deleted === "number" &&
                ` (${lastClear.details.deleted} record${lastClear.details.deleted === 1 ? "" : "s"})`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/qr" className="btn-secondary py-2 text-sm">
            Attendance QR code
          </Link>
          <a href={`/api/admin/export${filtersToSearch(filters, { page: 1 })}`} className="btn-secondary py-2 text-sm">
            Export CSV
          </a>
          <ClearAllData total={stats.total} />
          <form action={logout}>
            <button type="submit" className="btn-secondary py-2 text-sm" title={`Signed in as ${session.sub}`}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <AttendanceToggle
        key={String(attendance?.open)}
        open={attendance ? attendance.open : null}
        lastChanged={
          attendance?.updatedAt && attendance.updatedBy
            ? `Last changed by ${attendance.updatedBy} on ${formatDateTime(attendance.updatedAt)}`
            : null
        }
      />

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
        <Stat label="Total check-ins" value={stats.total} />
        <Stat label={`Within ${geofence.radiusMeters} m`} value={stats.within} tone="ok" />
        <Stat label={`Outside ${geofence.radiusMeters} m`} value={stats.outside} tone="bad" />
        <Stat label="Today" value={stats.today} />
      </section>

      <SubmissionsMap
        target={geofence.target}
        radiusMeters={geofence.radiusMeters}
        points={result.rows.map((r) => ({
          id: r.id,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracyM: r.accuracyM,
          distanceM: r.distanceM,
          status: r.geofenceStatus,
        }))}
      />

      <AdminFilters institutions={institutions} />

      <p className="mb-2 text-sm text-muted">
        {result.total === 0
          ? "No submissions match these filters."
          : `Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total}`}
      </p>

      <SubmissionsTable rows={result.rows} />

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          {result.page > 1 ? (
            <Link className="btn-secondary py-2 text-sm" href={`/admin${filtersToSearch(filters, { page: result.page - 1 })}`}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {result.page} of {totalPages}
          </span>
          {result.page < totalPages ? (
            <Link className="btn-secondary py-2 text-sm" href={`/admin${filtersToSearch(filters, { page: result.page + 1 })}`}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`tabular mt-1 text-3xl font-semibold ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}
