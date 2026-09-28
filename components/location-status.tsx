"use client";

import { formatDistance, type GeofenceStatus } from "@/lib/geo";

export type LocationState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      latitude: number;
      longitude: number;
      accuracy: number;
      timestamp: number;
      distance: number;
      status: GeofenceStatus;
      lowAccuracy: boolean;
    };

interface Props {
  state: LocationState;
  radiusMeters: number;
  onRequest: () => void;
}

export function LocationStatus({ state, radiusMeters, onRequest }: Props) {
  if (state.kind === "idle" || state.kind === "locating") {
    return (
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="mb-3 text-sm text-muted">
          We’ll ask your browser for permission to read your current location once, to check that you are within{" "}
          {radiusMeters} m of the venue.
        </p>
        <button type="button" onClick={onRequest} disabled={state.kind === "locating"} className="btn-secondary w-full">
          {state.kind === "locating" ? (
            <>
              <Spinner /> Detecting location…
            </>
          ) : (
            <>
              <PinIcon /> Get my location
            </>
          )}
        </button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div role="alert" className="rounded-lg bg-bad-bg p-4 text-sm text-bad">
        <p>{state.message}</p>
        <button type="button" onClick={onRequest} className="btn-secondary mt-3 w-full">
          Try again
        </button>
      </div>
    );
  }

  const within = state.status === "WITHIN_RANGE";
  return (
    <div aria-live="polite" className={`rounded-lg p-4 ${within ? "bg-ok-bg" : "bg-bad-bg"}`}>
      <p className="text-sm text-muted">Location detected successfully.</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">Distance from designated location</span>
        <span className="tabular text-lg font-semibold">{formatDistance(state.distance)}</span>
      </div>
      <p className={`mt-1 font-medium ${within ? "text-ok" : "text-bad"}`}>
        {within ? `✓ Within ${radiusMeters} meters` : `✗ Outside ${radiusMeters} meters`}
      </p>
      {!within && (
        <p className="mt-1 text-sm text-bad">
          Your location is outside the designated {radiusMeters}-meter area. You can still submit, but it will be recorded
          as outside the area.
        </p>
      )}
      <p className="tabular mt-2 text-xs text-muted">
        {state.latitude.toFixed(6)}, {state.longitude.toFixed(6)} · accuracy ±{Math.round(state.accuracy)} m
      </p>
      {state.lowAccuracy && (
        <p className="mt-2 rounded-md bg-warn-bg px-2.5 py-2 text-xs text-warn">
          Your location accuracy is low (±{Math.round(state.accuracy)} m). For a better reading, turn on GPS / precise
          location, move near a window or outdoors, and refresh.
        </p>
      )}
      <button type="button" onClick={onRequest} className="mt-3 text-sm font-medium text-accent underline-offset-2 hover:underline">
        Refresh location
      </button>
    </div>
  );
}

function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}
