"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { clearAllAttendance } from "@/app/admin/actions";
import { Spinner } from "@/components/ui/spinner";

/**
 * "Clear All Data" — permanently deletes every attendance record after an explicit
 * confirmation. Authorization is enforced by the server action, not by this button.
 */
export function ClearAllData({ total }: { total: number }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  // Synchronous lock: `pending` only updates on the next render, so rapid clicks would
  // otherwise all get through before the button is disabled.
  const inFlight = useRef(false);
  // Backdrop dismissal only when the press both started and ended on the backdrop
  // (a text-selection drag that ends outside the panel must not close the dialog).
  const pressedOnBackdrop = useRef(false);

  function open() {
    setMessage(null);
    dialogRef.current?.showModal();
  }

  function close() {
    if (!inFlight.current) dialogRef.current?.close();
  }

  function confirm() {
    if (inFlight.current) return; // exactly one request, however many clicks
    inFlight.current = true;
    startTransition(async () => {
      let outcome: { tone: "ok" | "bad"; text: string } | "login";
      try {
        const r = await clearAllAttendance();
        outcome =
          !r.ok && r.code === "UNAUTHENTICATED"
            ? "login" // session expired: nothing was deleted, sign in again
            : r.ok
              ? { tone: "ok", text: `Attendance data cleared successfully: ${r.deleted} record${r.deleted === 1 ? "" : "s"} deleted.` }
              : { tone: "bad", text: r.error };
      } catch {
        // No response (network failure or server crash): the request may or may not have
        // been processed, so don't claim either outcome.
        outcome = { tone: "bad", text: "Could not confirm the result (no response from the server). Refresh the page to see the current data, then try again if needed." };
      }
      inFlight.current = false; // release the lock first, so our own close() isn't undone
      dialogRef.current?.close();
      if (outcome === "login") router.replace("/admin/login");
      else setMessage(outcome);
    });
  }

  return (
    <>
      {/* Also shows progress, so it stays visible even if a browser force-closes the dialog. */}
      <button
        type="button"
        onClick={open}
        disabled={pending}
        aria-busy={pending}
        className="btn py-2 text-sm border border-bad/40 text-bad hover:bg-bad-bg"
      >
        {pending ? (
          <>
            <Spinner /> Clearing…
          </>
        ) : (
          "Clear All Data"
        )}
      </button>

      {message && (
        <p
          role={message.tone === "bad" ? "alert" : "status"}
          className={`basis-full rounded-lg px-3.5 py-2.5 text-sm ${message.tone === "ok" ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}
        >
          {message.text}
        </p>
      )}

      <dialog
        ref={dialogRef}
        // While deleting, the dialog can't be dismissed: `closedby="none"` where supported,
        // cancel is prevented, and if a browser closes it anyway (Chromium allows a repeated
        // Esc to bypass preventDefault) it is reopened so the progress stays visible.
        closedby={pending ? "none" : "any"}
        onCancel={(e) => {
          if (inFlight.current) e.preventDefault();
        }}
        onClose={() => {
          const d = dialogRef.current;
          if (!inFlight.current || !d || d.open || !d.isConnected) return;
          try {
            d.showModal();
          } catch {
            // Can't reopen (e.g. navigating away) — the header button still shows "Clearing…".
          }
        }}
        onPointerDown={(e) => {
          pressedOnBackdrop.current = e.target === dialogRef.current;
        }}
        onClick={(e) => {
          if (pressedOnBackdrop.current && e.target === dialogRef.current) close();
          pressedOnBackdrop.current = false;
        }}
        aria-labelledby="clear-all-title"
        aria-describedby="clear-all-desc"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="p-6">
          <h2 id="clear-all-title" className="text-lg font-semibold">
            Clear All Attendance Data?
          </h2>
          <div id="clear-all-desc" className="mt-2 space-y-2 text-sm text-muted">
            <p>
              This will permanently delete all currently stored attendance records and employee details
              {total > 0 ? ` (${total} record${total === 1 ? "" : "s"})` : ""}, including their location and check-in
              information.
            </p>
            <p className="font-medium text-bad">This action cannot be undone.</p>
            <p>Admin accounts, the workplace location, the QR code and all settings are not affected.</p>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} disabled={pending} className="btn-secondary py-2 text-sm" autoFocus>
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              aria-busy={pending}
              className="btn py-2 text-sm bg-bad text-white hover:brightness-110"
            >
              {pending ? (
                <>
                  <Spinner />
                  Clearing…
                </>
              ) : (
                "Clear All Data"
              )}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
