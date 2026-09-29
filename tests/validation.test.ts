import { describe, expect, it } from "vitest";
import { employeeSchema, fieldErrors, normalizeMobile } from "@/lib/validation";
import { qrPath } from "@/lib/qr-path";

describe("normalizeMobile", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["91 98765 43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+1 (415) 555-2671", "+14155552671"],
    ["+44 7911 123456", "+447911123456"],
  ])("accepts %s → %s", (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each(["", "12345", "5876543210", "+91 58765 43210", "+0 123456789", "98765abcde", "+1234567890123456", "call me"])(
    "rejects %s",
    (input) => {
      expect(normalizeMobile(input)).toBeNull();
    },
  );
});

describe("employeeSchema", () => {
  it("says 'is required' for empty fields and 'at least' for too-short ones", () => {
    const r = employeeSchema.safeParse({ name: "A", designation: "  ", institution: "", email: "", mobile: "" });
    const msgs = r.success ? {} : fieldErrors(r.error);
    expect(msgs).toEqual({
      name: "Employee name must be at least 2 characters.",
      designation: "Designation is required.",
      institution: "Institution is required.",
      email: "Email ID is required.",
      mobile: "Mobile number is required.",
    });
  });

  it("normalizes whitespace and email case", () => {
    const r = employeeSchema.parse({
      name: "  K.  Ramesh ",
      designation: " Lab\tAssistant ",
      institution: "CET",
      email: " K.Ramesh@CET.ac.in ",
      mobile: "+91 98470 12345",
    });
    expect(r).toEqual({
      name: "K. Ramesh",
      designation: "Lab Assistant",
      institution: "CET",
      email: "k.ramesh@cet.ac.in",
      mobile: "+919847012345",
    });
  });
});

describe("qrPath", () => {
  it("draws one unit square per dark module, offset by the quiet zone", () => {
    expect(qrPath(["10", "01"], 4)).toBe("M4 4h1v1h-1zM5 5h1v1h-1z");
  });
});
