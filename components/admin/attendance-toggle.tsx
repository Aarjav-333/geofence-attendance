"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { setAttendanceAccepting } from "@/app/admin/actions";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  /** null = the current setting couldn't be read */
  open: boolean | null;
  /** e.g. "Changed by master on 30 Sept 2026, 9:05 am" — preformatted on the server */
  lastChanged: string | null;
}

/** Admin switch: accept attendance (open) or show "Attendance Closed" to employees. */
export function AttendanceToggle({ open: initialOpen, lastChanged }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<boolean | null>(initialOpen);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false); // one request at a time, even on rapid clicks

  function change(next: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const r = await setAttendanceAccepting(next);
        if (r.ok) setOpen(r.open);
        else if (r.code === "UNAUTHENTICATED") router.replace("/admin/login");
        else setError(r.error);
      } catch {
        setError("Could not reach the server. Refresh the page to see the current state.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  if (open === null) {
    return (
      <section aria-label="Attendance status" className="mb-6 rounded-xl border border-warn/40 bg-warn-bg p-4">
        <p className="font-semibold text-warn">Attendance status unknown</p>
        <p className="text-sm text-muted">The current setting couldn&apos;t be read. You can still set it explicitly:</p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-bad">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => change(true)} disabled={pending} className="btn-secondary py-2 text-sm">
            Open attendance
          </button>
          <button type="button" onClick={() => change(false)} disabled={pending} className="btn-secondary py-2 text-sm">
            Close attendance
          </button>
          {pending && <Spinner />}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Attendance status"
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
        open ? "border-ok/30 bg-ok-bg" : "border-bad/30 bg-bad-bg"
      }`}
    >
      <div>
        <p className={`font-semibold ${open ? "text-ok" : "text-bad"}`}>
          {open ? "Attendance is OPEN" : "Attendance is CLOSED"}
        </p>
        <p className="text-sm text-muted">
          {open
            ? "Employees can verify their location and check in."
            : "Employees see “Attendance Closed” and check-ins are refused."}
          {lastChanged && <span className="block text-xs">{lastChanged}</span>}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-bad">
            {error}
          </p>
        )}
      </div>

      <label className="flex cursor-pointer items-center gap-3 select-none">
        <span className="text-sm font-medium">{pending ? "Saving…" : "Accept attendance"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Accept attendance"
          onClick={() => change(!open)}
          disabled={pending}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-60 ${
            open ? "bg-ok" : "bg-muted/50"
          }`}
        >
          <span
            className={`inline-flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
              open ? "translate-x-6" : "translate-x-1"
            }`}
          >
            {pending && <Spinner className="size-3 border-2 border-muted" />}
          </span>
        </button>
      </label>
    </section>
  );
}
