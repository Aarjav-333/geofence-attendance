"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { evaluateGeofence, formatDistance, type GeofenceConfig, type GeofenceStatus } from "@/lib/geo";
import { fieldErrors as toFieldErrors, submissionSchema } from "@/lib/validation";
import type { SubmitResponse } from "@/types/submission";
import { LocationStatus, type LocationState } from "./location-status";

interface Props {
  geofence: GeofenceConfig;
  lowAccuracyThreshold: number;
  departments: string[];
}

type Receipt = Extract<SubmitResponse, { ok: true }>["submission"];

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 };

function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Please allow location access to continue. If you blocked it earlier, enable location for this site in your browser settings and try again.";
    case err.POSITION_UNAVAILABLE:
      return "Unable to determine your current location. Make sure location services (GPS) are turned on and try again.";
    case err.TIMEOUT:
      return "Getting your location took too long. Move closer to a window or open area and try again.";
    default:
      return "Unable to determine your current location. Please try again.";
  }
}

export function RegistrationForm({ geofence, lowAccuracyThreshold, departments }: Props) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [memberId, setMemberId] = useState("");
  const [location, setLocation] = useState<LocationState>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  function requestLocation() {
    setFormError(null);
    setErrors((e) => ({ ...e, location: "", latitude: "", longitude: "", accuracy: "" }));

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setLocation({ kind: "error", message: "Location is only available over a secure (HTTPS) connection." });
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocation({ kind: "error", message: "Your browser does not support location services. Please use a recent version of Chrome, Safari, Firefox or Edge." });
      return;
    }

    setLocation({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        try {
          const result = evaluateGeofence({ latitude, longitude }, geofence);
          setLocation({
            kind: "ready",
            latitude,
            longitude,
            accuracy,
            timestamp: pos.timestamp,
            distance: result.distanceMeters,
            status: result.status,
            lowAccuracy: accuracy > lowAccuracyThreshold,
          });
        } catch {
          setLocation({ kind: "error", message: "Your device reported invalid coordinates. Please try again." });
        }
      },
      (err) => setLocation({ kind: "error", message: geolocationErrorMessage(err) }),
      GEO_OPTIONS,
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (location.kind !== "ready") {
      setErrors({ location: "Please share your location before submitting." });
      return;
    }

    const payload = {
      name,
      department,
      memberId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      positionTimestamp: Math.round(location.timestamp),
      clientDistanceMeters: location.distance,
    };

    const parsed = submissionSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as SubmitResponse | null;
      if (!data) throw new Error("bad response");
      if (!data.ok) {
        setFormError(data.error);
        if (data.fieldErrors) setErrors(data.fieldErrors);
        if (data.fieldErrors?.location) setLocation({ kind: "idle" });
        return;
      }
      setReceipt(data.submission);
    } catch {
      setFormError(
        navigator.onLine
          ? "We couldn't reach the server. Please check your connection and try again."
          : "You appear to be offline. Reconnect to the internet and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setName("");
    setDepartment("");
    setMemberId("");
    setLocation({ kind: "idle" });
    setReceipt(null);
    setErrors({});
  }

  if (receipt) return <SubmissionReceipt receipt={receipt} onReset={reset} />;

  const locationError = errors.location || errors.latitude || errors.longitude || errors.accuracy;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-7">
      <Field id="name" label="Full name" error={errors.name}>
        <input
          id="name"
          className="input"
          autoComplete="name"
          maxLength={100}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "name-error" : undefined}
        />
      </Field>

      <Field id="department" label="Department" error={errors.department}>
        <input
          id="department"
          className="input"
          list={departments.length ? "department-options" : undefined}
          autoComplete="organization-title"
          maxLength={100}
          required
          placeholder={departments.length ? "Select or type your department" : undefined}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          aria-invalid={!!errors.department}
          aria-describedby={errors.department ? "department-error" : undefined}
        />
        {departments.length > 0 && (
          <datalist id="department-options">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        )}
      </Field>

      <Field id="memberId" label="Employee / Student ID" error={errors.memberId}>
        <input
          id="memberId"
          className="input font-mono"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={50}
          required
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          aria-invalid={!!errors.memberId}
          aria-describedby={errors.memberId ? "memberId-error" : undefined}
        />
      </Field>

      <div>
        <span className="mb-1.5 block text-sm font-medium">Location</span>
        <LocationStatus state={location} radiusMeters={geofence.radiusMeters} onRequest={requestLocation} />
        {locationError && (
          <p role="alert" className="mt-1.5 text-sm text-bad">
            {locationError}
          </p>
        )}
      </div>

      {formError && (
        <div role="alert" className="rounded-lg bg-bad-bg px-3.5 py-3 text-sm text-bad">
          {formError}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={submitting || location.kind !== "ready"}>
        {submitting ? "Submitting…" : "Submit"}
      </button>
      {location.kind !== "ready" && (
        <p className="-mt-2 text-center text-xs text-muted">Share your location to enable submission.</p>
      )}
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function SubmissionReceipt({ receipt, onReset }: { receipt: Receipt; onReset: () => void }) {
  const within = receipt.status === ("WITHIN_RANGE" satisfies GeofenceStatus);
  return (
    <section
      aria-live="polite"
      className="space-y-5 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm sm:p-8"
    >
      <div
        className={`mx-auto flex size-14 items-center justify-center rounded-full text-2xl ${within ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}
        aria-hidden
      >
        {within ? "✓" : "!"}
      </div>
      <div>
        <h2 className="text-xl font-semibold">Submission received</h2>
        <p className="mt-1 text-muted">
          {within
            ? `Verified within ${receipt.radiusMeters} m of the designated location.`
            : `Recorded as outside the designated ${receipt.radiusMeters} m area.`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-left text-sm">
        <div className="rounded-lg bg-background p-3">
          <dt className="text-muted">Distance</dt>
          <dd className="tabular mt-0.5 font-medium">{formatDistance(receipt.distanceMeters)}</dd>
        </div>
        <div className="rounded-lg bg-background p-3">
          <dt className="text-muted">Status</dt>
          <dd className={`mt-0.5 font-medium ${within ? "text-ok" : "text-bad"}`}>
            {within ? "Within range" : "Outside range"}
          </dd>
        </div>
        <div className="col-span-2 rounded-lg bg-background p-3">
          <dt className="text-muted">Reference</dt>
          <dd className="mt-0.5 break-all font-mono text-xs">{receipt.id}</dd>
          <dd className="mt-1 text-xs text-muted">{new Date(receipt.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
      <button type="button" onClick={onReset} className="btn-secondary w-full">
        New submission
      </button>
    </section>
  );
}
