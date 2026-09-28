import { getDisplayTimezone } from "@/lib/config";
import { formatDistance } from "@/lib/geo";
import type { Submission } from "@/types/submission";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: getDisplayTimezone(),
});

export function StatusBadge({ status }: { status: Submission["geofenceStatus"] }) {
  const within = status === "WITHIN_RANGE";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-xs font-medium ${
        within ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"
      }`}
    >
      {within ? "✓" : "✗"} {status}
    </span>
  );
}

function Details({ r }: { r: Submission }) {
  const mapsUrl = `https://www.google.com/maps?q=${r.latitude},${r.longitude}`;
  const drift = r.clientDistanceM != null ? Math.abs(r.clientDistanceM - r.distanceM) : null;
  return (
    <details className="group">
      <summary className="cursor-pointer text-accent select-none">Details</summary>
      <dl className="tabular mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Coordinates</dt>
        <dd>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}
          </a>
        </dd>
        <dt className="text-muted">Accuracy</dt>
        <dd>±{r.accuracyM.toFixed(1)} m</dd>
        <dt className="text-muted">GPS fix at</dt>
        <dd>{r.positionCapturedAt ? dateFmt.format(new Date(r.positionCapturedAt)) : "—"}</dd>
        <dt className="text-muted">Target used</dt>
        <dd>
          {r.targetLatitude.toFixed(6)}, {r.targetLongitude.toFixed(6)} · {r.radiusM} m
        </dd>
        {drift != null && drift > 1 && (
          <>
            <dt className="text-muted">Client claimed</dt>
            <dd className="text-warn">{formatDistance(r.clientDistanceM!)} (differs from server)</dd>
          </>
        )}
        <dt className="text-muted">Device</dt>
        <dd className="max-w-xs truncate" title={r.userAgent ?? ""}>
          {r.userAgent ?? "—"}
        </dd>
        <dt className="text-muted">Ref</dt>
        <dd className="font-mono">{r.id}</dd>
      </dl>
    </details>
  );
}

export function SubmissionsTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) return null;

  return (
    <>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 text-right font-medium">Distance</th>
              <th className="px-4 py-3 font-medium">Location status</th>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3">{r.department}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.memberId}</td>
                <td className="tabular px-4 py-3 text-right">
                  {formatDistance(r.distanceM)}
                  {r.lowAccuracy && (
                    <div className="text-xs text-warn" title="GPS accuracy was worse than the configured threshold">
                      ±{Math.round(r.accuracyM)} m, low accuracy
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.geofenceStatus} />
                </td>
                <td className="tabular whitespace-nowrap px-4 py-3">{dateFmt.format(new Date(r.createdAt))}</td>
                <td className="px-4 py-3">
                  <Details r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-muted">
                  {r.department} · <span className="font-mono text-xs">{r.memberId}</span>
                </div>
              </div>
              <StatusBadge status={r.geofenceStatus} />
            </div>
            <div className="tabular mt-2 flex justify-between text-muted">
              <span>
                {formatDistance(r.distanceM)}
                {r.lowAccuracy && <span className="text-warn"> · low accuracy</span>}
              </span>
              <span>{dateFmt.format(new Date(r.createdAt))}</span>
            </div>
            <div className="mt-2">
              <Details r={r} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
