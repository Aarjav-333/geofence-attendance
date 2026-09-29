"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { formatDistance } from "@/lib/geo";
import { employeeSchema, fieldErrors as toFieldErrors, validateEmployeeField, type EmployeeField } from "@/lib/validation";
import type { CheckInResponse, VerifyResponse } from "@/types/submission";

type Phase =
  | { k: "idle"; notice?: string }
  | { k: "locating" }
  | { k: "verifying" }
  | { k: "error"; message: string }
  | { k: "outside"; distance: number; radius: number; accuracy: number }
  | {
      k: "verified";
      distance: number;
      radius: number;
      accuracy: number;
      lowAccuracy: boolean;
      token: string;
      expiresAt: string;
    }
  | { k: "done"; name: string; createdAt: string };

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 };

const EMPTY_FORM: Record<EmployeeField, string> = { name: "", designation: "", institution: "", email: "", mobile: "" };
const FIELDS = Object.keys(EMPTY_FORM) as EmployeeField[];

function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location access was denied. Attendance requires your location — allow location for this site in your browser settings (tap the lock/ⓘ icon next to the address) and try again.";
    case err.POSITION_UNAVAILABLE:
      return "Your location is currently unavailable. Make sure location services / GPS are turned on and try again.";
    case err.TIMEOUT:
      return "Detecting your location took too long. Move near a window or outdoors and try again.";
    default:
      return "Unable to determine your current location. Please try again.";
  }
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS));
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AttendanceFlow({ radiusMeters }: { radiusMeters: number }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [form, setForm] = useState<Record<EmployeeField, string>>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState<Set<EmployeeField>>(new Set());

  async function detectLocation() {
    setFormError(null);
    if (!window.isSecureContext) {
      setPhase({ k: "error", message: "Location is only available over a secure (HTTPS) connection. Please open the attendance link again." });
      return;
    }
    if (!("geolocation" in navigator)) {
      setPhase({ k: "error", message: "This browser does not support location services. Please use a recent version of Chrome, Safari, Firefox or Edge." });
      return;
    }

    setPhase({ k: "locating" });
    let pos: GeolocationPosition;
    try {
      pos = await getPosition();
    } catch (err) {
      setPhase({ k: "error", message: geolocationErrorMessage(err as GeolocationPositionError) });
      return;
    }

    const { latitude, longitude, accuracy } = pos.coords;
    if (![latitude, longitude, accuracy].every(Number.isFinite)) {
      setPhase({ k: "error", message: "Your device reported invalid location data. Please try again." });
      return;
    }

    setPhase({ k: "verifying" });
    try {
      const res = await fetch("/api/attendance/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude, accuracy, positionTimestamp: Math.round(pos.timestamp) }),
      });
      const data = (await res.json().catch(() => null)) as VerifyResponse | null;
      if (!data) throw new Error("bad response");
      if (!data.ok) {
        setPhase({ k: "error", message: data.error });
        return;
      }
      if (data.status === "WITHIN_RANGE" && data.verificationToken && data.expiresAt) {
        setPhase({
          k: "verified",
          distance: data.distanceMeters,
          radius: data.radiusMeters,
          accuracy: data.accuracyMeters,
          lowAccuracy: data.lowAccuracy,
          token: data.verificationToken,
          expiresAt: data.expiresAt,
        });
      } else {
        setPhase({ k: "outside", distance: data.distanceMeters, radius: data.radiusMeters, accuracy: data.accuracyMeters });
      }
    } catch {
      setPhase({
        k: "error",
        message: navigator.onLine
          ? "We couldn't reach the server to verify your location. Please check your connection and try again."
          : "You appear to be offline. Reconnect to the internet and try again.",
      });
    }
  }

  async function onCheckIn(e: FormEvent) {
    e.preventDefault();
    if (phase.k !== "verified") return;
    setFormError(null);

    // Every field is required and validated with the same schema the server enforces.
    const parsed = employeeSchema.safeParse(form);
    if (!parsed.success) {
      const errs = toFieldErrors(parsed.error);
      setErrors(errs);
      setTouched(new Set(FIELDS));
      document.getElementById(FIELDS.find((f) => errs[f]) ?? "name")?.focus();
      return;
    }
    setErrors({});

    if (Date.parse(phase.expiresAt) <= Date.now()) {
      setPhase({ k: "idle", notice: "Your location verification expired. Please detect your location again — your details are kept." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, verificationToken: phase.token }),
      });
      const data = (await res.json().catch(() => null)) as CheckInResponse | null;
      if (!data) throw new Error("bad response");
      if (data.ok) {
        setPhase({ k: "done", name: data.checkIn.name, createdAt: data.checkIn.createdAt });
        setForm(EMPTY_FORM);
        setTouched(new Set());
        return;
      }
      if (data.code === "OUTSIDE_RANGE" && data.distanceMeters !== undefined) {
        setPhase({ k: "outside", distance: data.distanceMeters, radius: phase.radius, accuracy: phase.accuracy });
      } else if (data.code === "VERIFICATION_REQUIRED" || data.code === "ALREADY_USED") {
        setPhase({ k: "idle", notice: `${data.error} Your details are kept.` });
      } else {
        setFormError(data.error);
        if (data.fieldErrors) setErrors(data.fieldErrors);
      }
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

  // Immediate feedback: validate a field when it loses focus, then live while it is being corrected.
  const set = (field: EmployeeField) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    if (touched.has(field)) setErrors((errs) => ({ ...errs, [field]: validateEmployeeField(field, value) ?? "" }));
  };
  const blur = (field: EmployeeField) => () => {
    setTouched((t) => new Set(t).add(field));
    setErrors((errs) => ({ ...errs, [field]: validateEmployeeField(field, form[field]) ?? "" }));
  };

  if (phase.k === "done") {
    return (
      <Card>
        <section aria-live="polite" className="space-y-4 text-center">
          <Badge tone="ok">✓</Badge>
          <div>
            <h2 className="text-xl font-semibold">Check-In Successful ✓</h2>
            <p className="mt-1 text-muted">Your attendance has been recorded.</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-left text-sm">
            <Stat label="Name" value={phase.name} wide />
            <Stat label="Time" value={timeLabel(phase.createdAt)} wide />
          </dl>
        </section>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        {(phase.k === "idle" || phase.k === "error") && (
          <div className="space-y-4">
            {phase.k === "idle" && phase.notice && (
              <p role="status" className="rounded-lg bg-warn-bg px-3.5 py-3 text-sm text-warn">
                {phase.notice}
              </p>
            )}
            {phase.k === "error" ? (
              <div role="alert" className="rounded-lg bg-bad-bg px-3.5 py-3 text-sm text-bad">
                {phase.message}
              </div>
            ) : (
              <p className="text-muted">
                Please allow location access to continue. Your location is checked once to confirm you are within{" "}
                {radiusMeters} m of the workplace.
              </p>
            )}
            <button type="button" onClick={detectLocation} className="btn-primary w-full">
              <PinIcon /> {phase.k === "error" ? "Try again" : "Detect My Location"}
            </button>
          </div>
        )}

        {(phase.k === "locating" || phase.k === "verifying") && (
          <div aria-live="polite" className="flex flex-col items-center gap-3 py-4 text-center">
            <Spinner className="size-8 border-3 border-accent" />
            <p className="font-medium">{phase.k === "locating" ? "Detecting your location…" : "Verifying your location…"}</p>
            <p className="text-sm text-muted">
              {phase.k === "locating" ? "Please wait. Allow location access if your browser asks." : "Please wait."}
            </p>
          </div>
        )}

        {phase.k === "outside" && (
          <div role="alert" className="space-y-4">
            <div className="rounded-lg bg-bad-bg p-4 text-bad">
              <p className="font-semibold">Location verification failed</p>
              <p className="mt-1 text-sm">You are outside the authorized workplace area. Attendance is unavailable.</p>
              <dl className="tabular mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt>Distance</dt>
                <dd className="font-semibold">{formatDistance(phase.distance)}</dd>
                <dt>Required</dt>
                <dd>within {phase.radius} meters</dd>
                <dt>GPS accuracy</dt>
                <dd>±{Math.round(phase.accuracy)} m</dd>
              </dl>
            </div>
            <p className="text-sm text-muted">If you are at the workplace, move to an open area for a better GPS signal and try again.</p>
            <button type="button" onClick={detectLocation} className="btn-secondary w-full">
              <PinIcon /> Check my location again
            </button>
          </div>
        )}

        {phase.k === "verified" && (
          <div aria-live="polite" className="rounded-lg bg-ok-bg p-4">
            <p className="font-semibold text-ok">Location verified ✓</p>
            <p className="mt-1 text-sm">You are within the authorized workplace area.</p>
            <p className="tabular mt-2 text-sm">
              Distance: <span className="font-semibold">{formatDistance(phase.distance)}</span>
              <span className="text-muted"> · accuracy ±{Math.round(phase.accuracy)} m</span>
            </p>
            {phase.lowAccuracy && (
              <p className="mt-2 text-xs text-warn">GPS accuracy is low; your check-in will be flagged for review.</p>
            )}
            <p className="mt-2 text-xs text-muted">Complete the form by {new Date(phase.expiresAt).toLocaleTimeString(undefined, { timeStyle: "short" })}.</p>
          </div>
        )}
      </Card>

      {phase.k === "verified" && (
        <Card>
          <form onSubmit={onCheckIn} noValidate className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Your details</h2>
              <p className="mt-0.5 text-sm text-muted">
                All fields are required<span className="text-bad" aria-hidden> *</span>
              </p>
            </div>
            <Field id="name" label="Employee Name" required error={errors.name}>
              <input id="name" className="input" autoComplete="name" maxLength={100} required value={form.name} onChange={set("name")} onBlur={blur("name")} aria-required aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} />
            </Field>
            <Field id="designation" label="Designation" required error={errors.designation}>
              <input id="designation" className="input" autoComplete="organization-title" maxLength={100} required value={form.designation} onChange={set("designation")} onBlur={blur("designation")} aria-required aria-invalid={!!errors.designation} aria-describedby={errors.designation ? "designation-error" : undefined} />
            </Field>
            <Field id="institution" label="Institution" required error={errors.institution}>
              <input id="institution" className="input" autoComplete="organization" maxLength={150} required value={form.institution} onChange={set("institution")} onBlur={blur("institution")} aria-required aria-invalid={!!errors.institution} aria-describedby={errors.institution ? "institution-error" : undefined} />
            </Field>
            <Field id="email" label="Email ID" required error={errors.email}>
              <input id="email" type="email" inputMode="email" className="input" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={form.email} onChange={set("email")} onBlur={blur("email")} aria-required aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} />
            </Field>
            <Field id="mobile" label="Mobile Number" required error={errors.mobile}>
              <input id="mobile" type="tel" inputMode="tel" className="input" autoComplete="tel" maxLength={20} placeholder="98765 43210" required value={form.mobile} onChange={set("mobile")} onBlur={blur("mobile")} aria-required aria-invalid={!!errors.mobile} aria-describedby={errors.mobile ? "mobile-error" : undefined} />
            </Field>
            {formError && (
              <div role="alert" className="rounded-lg bg-bad-bg px-3.5 py-3 text-sm text-bad">
                {formError}
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? "Checking in…" : "Check In"}
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-7">{children}</div>;
}

function Badge({ tone, children }: { tone: "ok" | "bad"; children: ReactNode }) {
  return (
    <div
      className={`mx-auto flex size-14 items-center justify-center rounded-full text-2xl ${tone === "ok" ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}
      aria-hidden
    >
      {children}
    </div>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg bg-background p-3 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Field({ id, label, required, error, children }: { id: string; label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span className="text-bad" aria-hidden>
            {" "}*
          </span>
        )}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}
