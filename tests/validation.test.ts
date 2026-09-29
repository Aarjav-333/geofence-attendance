import { describe, expect, it } from "vitest";
import { employeeSchema, fieldErrors, normalizeMobile, validateEmployeeField } from "@/lib/validation";
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
  const VALID = {
    name: "Anita Menon",
    designation: "Assistant Professor",
    institution: "College of Engineering Trivandrum",
    email: "user@example.com",
    mobile: "98765 43210",
  };
  const errorsFor = (input: Record<string, unknown>) => {
    const r = employeeSchema.safeParse(input);
    return r.success ? {} : fieldErrors(r.error);
  };

  it("accepts a fully valid form", () => {
    expect(employeeSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires every field: empty → '<Field> is required.'", () => {
    expect(errorsFor({ name: "", designation: "", institution: "", email: "", mobile: "" })).toEqual({
      name: "Employee Name is required.",
      designation: "Designation is required.",
      institution: "Institution is required.",
      email: "Email ID is required.",
      mobile: "Mobile Number is required.",
    });
  });

  it.each(["name", "designation", "institution", "email", "mobile"] as const)(
    "each field is individually required: %s empty / whitespace-only / missing",
    (field) => {
      for (const bad of ["", "   ", "\t \n", undefined]) {
        const errs = errorsFor({ ...VALID, [field]: bad });
        expect(Object.keys(errs)).toEqual([field]);
        expect(errs[field]).toMatch(/is required\.$/);
        expect(validateEmployeeField(field, bad ?? "")).toMatch(/is required\.$/);
      }
    },
  );

  it("too short → 'at least 2 characters'", () => {
    expect(errorsFor({ ...VALID, name: "A" }).name).toBe("Employee Name must be at least 2 characters.");
    expect(errorsFor({ ...VALID, designation: "X" }).designation).toBe("Designation must be at least 2 characters.");
  });

  it.each([
    ["name", "Agent 007"],
    ["name", "<script>"],
    ["name", "Anita@Menon"],
    ["designation", "Professor <b>"],
    ["designation", "#1 Manager"],
    ["designation", "12345"],
    ["institution", "CET; DROP TABLE"],
    ["institution", "{College}"],
    ["institution", "$$$"],
  ] as const)("rejects clearly invalid %s: %s", (field, value) => {
    expect(errorsFor({ ...VALID, [field]: value })[field]).toBeTruthy();
  });

  it.each([
    ["designation", "Sr. Grade-2 Officer (Admin)"],
    ["designation", "Head of Dept., CSE"],
    ["institution", "College of Engineering, Trivandrum"],
    ["institution", "St. Xavier's College"],
    ["institution", "A.P.J. Abdul Kalam Technological University"],
    ["institution", "Dept. of Science & Technology"],
    ["name", "D'Souza O'Brien-Nair"],
    ["name", "അനിത മേനോൻ"],
  ] as const)("accepts normal %s text: %s", (field, value) => {
    expect(errorsFor({ ...VALID, [field]: value })).toEqual({});
  });

  it.each(["abc", "abc@", "abc.com@", "@example.com", "user@", "user@@example.com", "user example@x.com"])(
    "rejects invalid email %s",
    (email) => {
      expect(errorsFor({ ...VALID, email }).email).toBe("Enter a valid email address, e.g. user@example.com.");
    },
  );

  it("accepts and trims a valid email", () => {
    expect(employeeSchema.parse({ ...VALID, email: "  User@Example.com " }).email).toBe("user@example.com");
  });

  it.each(["98765abcde", "12345", "0000000000", "5876543210", "+91 58765 43210", "call me", "98765 43210 x"])(
    "rejects invalid mobile %s",
    (mobile) => {
      expect(errorsFor({ ...VALID, mobile }).mobile).toMatch(/valid mobile number/);
    },
  );

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
