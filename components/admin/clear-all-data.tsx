"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { clearAllAttendance } from "@/app/admin/actions";

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
      try {
        const r = await clearAllAttendance();
        dialogRef.current?.close();
        if (!r.ok && r.code === "UNAUTHENTICATED") {
          router.replace("/admin/login"); // session expired: nothing was deleted, sign in again
          return;
        }
        setMessage(
          r.ok
            ? { tone: "ok", text: `All attendance data has been cleared successfully (${r.deleted} record${r.deleted === 1 ? "" : "s"} deleted).` }
            : { tone: "bad", text: r.error },
        );
      } catch {
        dialogRef.current?.close();
        // No response (network failure or server crash): the request may or may not have
        // been processed, so don't claim either outcome.
        setMessage({ tone: "bad", text: "Could not confirm the result (no response from the server). Refresh the page to see the current data, then try again if needed." });
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="btn py-2 text-sm border border-bad/40 text-bad hover:bg-bad-bg"
      >
        Clear All Data
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
        onCancel={(e) => {
          if (inFlight.current) e.preventDefault(); // Esc can't abandon an in-flight delete
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close(); // click on backdrop
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
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
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
