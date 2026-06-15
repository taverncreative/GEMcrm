/**
 * Schema strictness contract (Pass 1b).
 *
 * The quick-add leniency is confined to the create path: the SHARED
 * SiteSchema + BookingSchema are strict (so the standalone Add Site form,
 * the site-page QuickBookingForm, and the draft-upgrade flow all reject
 * missing required fields at the SERVER), while a dedicated
 * BookingCreateSchema lets createQuickBookingAction accept a blank call type.
 */
import { describe, it, expect } from "vitest";
import { SiteSchema } from "@/lib/validation/site";
import { BookingSchema, BookingCreateSchema } from "@/lib/validation/booking";

describe("shared schemas stay strict (server-side rejection)", () => {
  it("SiteSchema rejects a blank address (Add Site + upgrade enforce it)", () => {
    expect(
      SiteSchema.safeParse({
        address_line_1: "",
        town: "",
        county: "",
        postcode: "",
      }).success
    ).toBe(false);
    expect(
      SiteSchema.safeParse({
        address_line_1: "1 Way",
        town: "Town",
        county: "Kent",
        postcode: "",
      }).success
    ).toBe(true);
  });

  it("BookingSchema rejects a blank call_type", () => {
    const base = { site_id: "s1", job_date: "2026-07-01" };
    expect(BookingSchema.safeParse({ ...base, call_type: "" }).success).toBe(false);
    expect(
      BookingSchema.safeParse({ ...base, call_type: "routine" }).success
    ).toBe(true);
  });
});

describe("BookingCreateSchema (create path only) is lenient on call_type", () => {
  it("accepts a blank call_type", () => {
    const base = { site_id: "s1", job_date: "2026-07-01" };
    expect(BookingCreateSchema.safeParse({ ...base, call_type: "" }).success).toBe(
      true
    );
    expect(
      BookingCreateSchema.safeParse({ ...base, call_type: "routine" }).success
    ).toBe(true);
  });

  it("still requires job_date (the booking minimum)", () => {
    expect(
      BookingCreateSchema.safeParse({ site_id: "s1", job_date: "", call_type: "" })
        .success
    ).toBe(false);
  });
});
