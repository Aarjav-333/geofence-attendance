/** Shown instead of the attendance flow while an admin has closed attendance. */
export function AttendanceClosed() {
  return (
    <section
      role="status"
      aria-live="polite"
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm sm:p-8"
    >
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-bad-bg text-bad" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold">Attendance Closed</h2>
        <p className="mt-1 text-muted">Attendance is not being accepted at the moment.</p>
        <p className="mt-1 text-sm text-muted">Please check with your administrator.</p>
      </div>
    </section>
  );
}
