/**
 * call_type "Other" free-text description — the required-when-Other gate on
 * both booking schemas and the service-sheet schema, and the storage rule
 * that clears a stale description when the type is not "other".
 *
 * jobs.call_type is a scalar with a CHECK constraint, so the description
 * lives in its own column (jobs.call_type_other_desc) rather than folding
 * inline the way the pest/method "Other: <desc>" strings do.
 */
import { describe, it, expect } from "vitest";
import {
  BookingSchema,
  BookingCreateSchema,
} from "@/lib/validation/booking";
import { ServiceSheetSchema } from "@/lib/validation/service-sheet";
import { callTypeOtherDescForStorage } from "@/lib/utils/call-type-other";

const baseBooking = {
  site_id: "s1",
  job_date: "2026-07-01",
};

const baseSheet = {
  job_id: "j1",
  pest_species: ["Rats"],
  findings: "f",
  recommendations: "r",
  method_used: ["Inspection"],
  pesticides_used: "None",
  risk_level: "low" as const,
  risk_comments: "none",
  technician_signature: "data:image/png;base64,x",
};

describe("required-when-Other on the booking schemas", () => {
  it("BookingSchema rejects call_type 'other' with a blank description", () => {
    const res = BookingSchema.safeParse({
      ...baseBooking,
      call_type: "other",
      call_type_other_desc: "   ",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toContain("call_type_other_desc");
    }
  });

  it("BookingSchema accepts call_type 'other' with a description", () => {
    expect(
      BookingSchema.safeParse({
        ...baseBooking,
        call_type: "other",
        call_type_other_desc: "Insect identification",
      }).success
    ).toBe(true);
  });

  it("BookingSchema does not require a description for a non-other type", () => {
    expect(
      BookingSchema.safeParse({
        ...baseBooking,
        call_type: "routine",
        call_type_other_desc: "",
      }).success
    ).toBe(true);
  });

  it("BookingCreateSchema (lenient) still enforces the gate when other", () => {
    expect(
      BookingCreateSchema.safeParse({
        ...baseBooking,
        call_type: "other",
        call_type_other_desc: "",
      }).success
    ).toBe(false);
    // ...but a blank call_type (quick add, none chosen) is fine.
    expect(
      BookingCreateSchema.safeParse({
        ...baseBooking,
        call_type: "",
        call_type_other_desc: "",
      }).success
    ).toBe(true);
  });
});

describe("required-when-Other on the service-sheet schema", () => {
  it("rejects 'other' with a blank description", () => {
    const res = ServiceSheetSchema.safeParse({
      ...baseSheet,
      call_type: "other",
      call_type_other_desc: "",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("call_type_other_desc"))).toBe(
        true
      );
    }
  });

  it("accepts 'other' with a description, and a non-other type without one", () => {
    expect(
      ServiceSheetSchema.safeParse({
        ...baseSheet,
        call_type: "other",
        call_type_other_desc: "Insect identification",
      }).success
    ).toBe(true);
    expect(
      ServiceSheetSchema.safeParse({
        ...baseSheet,
        call_type: "routine",
        call_type_other_desc: "",
      }).success
    ).toBe(true);
  });
});

describe("the description round-trips through parse into the writer input", () => {
  it("BookingCreateSchema preserves call_type_other_desc for createBooking", () => {
    const res = BookingCreateSchema.safeParse({
      ...baseBooking,
      call_type: "other",
      call_type_other_desc: "Insect identification",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      // createBooking reads this off the parsed input, then
      // callTypeOtherDescForStorage decides whether to persist it.
      expect(res.data.call_type_other_desc).toBe("Insect identification");
    }
  });

  it("ServiceSheetSchema preserves call_type_other_desc for writeServiceSheet", () => {
    const res = ServiceSheetSchema.safeParse({
      ...baseSheet,
      call_type: "other",
      call_type_other_desc: "Insect identification",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.call_type_other_desc).toBe("Insect identification");
    }
  });
});

describe("callTypeOtherDescForStorage — clears a stale description", () => {
  it("keeps a trimmed description when the type is 'other'", () => {
    expect(callTypeOtherDescForStorage("other", "  Insect ID  ")).toBe("Insect ID");
  });

  it("returns null for 'other' with a blank description", () => {
    expect(callTypeOtherDescForStorage("other", "   ")).toBeNull();
    expect(callTypeOtherDescForStorage("other", undefined)).toBeNull();
  });

  it("returns null for any non-other type, even if a description lingers", () => {
    expect(callTypeOtherDescForStorage("routine", "old desc")).toBeNull();
    expect(callTypeOtherDescForStorage("", "old desc")).toBeNull();
    expect(callTypeOtherDescForStorage(null, "old desc")).toBeNull();
  });
});
