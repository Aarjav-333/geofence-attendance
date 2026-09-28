import { z } from "zod";

/**
 * Submission payload schema — the single source of truth for what the API accepts.
 *
 * Deliberately NOT accepted from the client: distance, geofence status,
 * timestamps, IDs. Those are computed on the server. `clientDistanceMeters`
 * is stored for auditing only (to spot tampering / GPS drift) and never
 * influences the result.
 */

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => s.normalize("NFKC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`)
        // Reject control characters (other whitespace was already collapsed above)
        .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), `${label} contains invalid characters.`),
    );

export const submissionSchema = z.object({
  name: text("Full name", 2, 100).refine(
    (s) => /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(s),
    "Full name may only contain letters, spaces, apostrophes, periods and hyphens.",
  ),
  department: text("Department", 1, 100),
  memberId: text("Employee / Student ID", 1, 50).refine(
    (s) => /^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(s),
    "ID may only contain letters, numbers and - _ / .",
  ),
  latitude: z
    .number({ error: "Latitude must be a number." })
    .finite("Latitude must be a finite number.")
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  longitude: z
    .number({ error: "Longitude must be a number." })
    .finite("Longitude must be a finite number.")
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
  accuracy: z
    .number({ error: "Location accuracy must be a number." })
    .finite()
    .nonnegative("Location accuracy cannot be negative.")
    .max(100_000, "Location accuracy is too poor to verify your position."),
  /** Epoch ms when the browser obtained the fix (GeolocationPosition.timestamp). */
  positionTimestamp: z.number().int().positive().optional(),
  clientDistanceMeters: z.number().finite().nonnegative().optional(),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

/** Flatten Zod issues into { field: message } for the UI. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
