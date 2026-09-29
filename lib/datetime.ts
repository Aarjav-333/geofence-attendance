import "server-only";
import { getDisplayTimezone } from "./config";

let formatter: Intl.DateTimeFormat | undefined;

/** Admin-dashboard timestamp, e.g. "29 Sept 2026, 11:15 pm", in DISPLAY_TIMEZONE. */
export function formatDateTime(value: Date | string | number): string {
  formatter ??= new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getDisplayTimezone(),
  });
  return formatter.format(value instanceof Date ? value : new Date(value));
}
