import { z } from "zod";

/**
 * Request schemas — the single source of truth for what the attendance API accepts.
 * Shared by the browser (instant feedback) and the server (authoritative).
 *
 * Deliberately NOT accepted from the client: distance, geofence status,
 * timestamps, IDs. Those are computed on the server.
 */

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => s.normalize("NFKC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required.`)
        .min(min, `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`)
        // Reject control characters (other whitespace was already collapsed above)
        .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), `${label} contains invalid characters.`),
    );

/** Step 1 — a raw GPS fix from the Geolocation API. */
export const locationSchema = z.object({
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
    .finite("Location accuracy must be a finite number.")
    .nonnegative("Location accuracy cannot be negative."),
  /** Epoch ms when the browser obtained the fix (GeolocationPosition.timestamp). */
  positionTimestamp: z.number({ error: "Location timestamp is required." }).int().positive(),
});

export type LocationInput = z.infer<typeof locationSchema>;

/**
 * Normalize a mobile number to E.164 (+<country><number>).
 * Accepts Indian numbers without a country code (98765 43210, 098765 43210, 91 98765 43210)
 * and international numbers written with a leading "+". Returns null if invalid.
 */
export function normalizeMobile(input: string): string | null {
  const raw = input.trim();
  if (!/^\+?[\d\s\-().]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // E.164: country code (no leading 0) + subscriber number, 8–15 digits total
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) return null;
    return `+${digits}`;
  }
  const national = digits.length === 11 && digits.startsWith("0") ? digits.slice(1)
    : digits.length === 12 && digits.startsWith("91") ? digits.slice(2)
    : digits;
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/**
 * Designation / institution: normal text — letters (any script), numbers, spaces and
 * common punctuation — starting with a letter or number and containing at least one letter.
 * Rejects symbols such as < > { } @ # $ % * = + | ; that never appear in these names.
 */
const ORG_TEXT = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,&()'’/:-]*$/u;
const orgText = (label: string, max: number) =>
  text(label, 2, max)
    .refine((s) => ORG_TEXT.test(s), `${label} may only contain letters, numbers, spaces and . , & ( ) ' / : -`)
    .refine((s) => /\p{L}/u.test(s), `${label} must contain letters.`);

/** Step 2 — employee details, shown only after the server verified the location. All fields are required. */
export const employeeSchema = z.object({
  name: text("Employee Name", 2, 100).refine(
    (s) => /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(s),
    "Employee Name may only contain letters, spaces, apostrophes, periods and hyphens.",
  ),
  designation: orgText("Designation", 100),
  institution: orgText("Institution", 150),
  email: z
    .string({ error: "Email ID is required." })
    .trim()
    .min(1, "Email ID is required.")
    .max(254, "Email ID is too long.")
    .pipe(z.email("Enter a valid email address, e.g. user@example.com."))
    .transform((s) => s.toLowerCase()),
  mobile: z
    .string({ error: "Mobile Number is required." })
    .trim()
    .min(1, "Mobile Number is required.")
    .transform((s, ctx) => {
      const normalized = normalizeMobile(s);
      if (!normalized) {
        ctx.addIssue({ code: "custom", message: "Enter a valid mobile number, e.g. 98765 43210 or +91 98765 43210." });
        return z.NEVER;
      }
      return normalized;
    }),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type EmployeeField = keyof typeof employeeSchema.shape;

/** Validate one employee field (for as-you-type feedback). Returns the error message or null. */
export function validateEmployeeField(field: EmployeeField, value: string): string | null {
  const r = employeeSchema.shape[field].safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? "Invalid value.");
}

/** Check In request: employee details + the signed location verification from step 1. */
export const checkInSchema = employeeSchema.extend({
  verificationToken: z.string({ error: "Location verification is required." }).min(1).max(4096),
});

/** Flatten Zod issues into { field: message } for the UI. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
