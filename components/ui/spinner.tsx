/** Loading spinner. Size/colour via className; defaults to a small spinner in the current text colour. */
export function Spinner({ className = "size-4 border-2 border-current" }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-t-transparent ${className}`} aria-hidden />;
}
