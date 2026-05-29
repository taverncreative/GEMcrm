/**
 * Cross-schema null-rejection regression tests.
 *
 * Background. Several server actions previously cast `formData.get(key)
 * as string` and fed the result to a Zod schema using
 * `z.string().optional().default("")`. At runtime formData.get returns
 * `null` for missing keys; .optional() accepts undefined but NOT null;
 * the action returns { success: false } with a Zod error the operator
 * never sees and the outbox marks the entry stuck. Bit twice in the
 * wild — createCustomerAction (domestic save) and
 * completeServiceSheetAction (Customer Present = No).
 *
 * Fix per action: an explicit `str(key)` helper that coerces null → "".
 * These tests sweep every schema with an optional-string field and
 * verify the schema rejects null on each such field — proving that
 * the action's coalesce is load-bearing and that ANY new action
 * reusing the pattern must do the same.
 */
import { describe, it, expect } from "vitest";
import { SiteSchema } from "@/lib/validation/site";
import { BookingSchema } from "@/lib/validation/booking";
import { AgreementSchema } from "@/lib/validation/agreement";

function validSite(overrides: Record<string, unknown> = {}) {
  return {
    address_line_1: "1 Test Lane",
    address_line_2: "",
    town: "Test Town",
    county: "Test County",
    postcode: "TT1 1TT",
    ...overrides,
  };
}

function validBooking(overrides: Record<string, unknown> = {}) {
  return {
    site_id: "test-site-id",
    job_date: "2026-06-12",
    job_time: "",
    call_type: "routine",
    pest_species: ["Mice"],
    value: "100",
    report_notes: "",
    parent_job_id: "",
    ...overrides,
  };
}

function validAgreement(overrides: Record<string, unknown> = {}) {
  return {
    customer_id: "test-cust-id",
    site_id: "test-site-id",
    reference_number: "REF-001",
    contact_name: "Acme Ltd",
    contact_email: "ops@acme.example",
    contact_phone: "01234567890",
    mobile: "",
    invoice_address: "1 Test Lane, TT1 1TT",
    start_date: "2026-01-01",
    visit_frequency: "6",
    contract_value: "1200",
    pest_species: ["Mice"],
    callout_terms: "48-hour response within working hours",
    terms_text: "",
    client_signature: "data:image/png;base64,CLIENT",
    gem_signature: "data:image/png;base64,GEM",
    client_signatory_name: "Jane Doe",
    signed_date: "",
    ...overrides,
  };
}

describe("SiteSchema — null rejection", () => {
  it("accepts the canonical post-fix shape (empty optional string)", () => {
    expect(SiteSchema.safeParse(validSite()).success).toBe(true);
  });

  it("rejects null on address_line_2 (the optional field)", () => {
    expect(SiteSchema.safeParse(validSite({ address_line_2: null })).success).toBe(
      false
    );
  });
});

describe("BookingSchema — null rejection", () => {
  it("accepts the canonical post-fix shape", () => {
    expect(BookingSchema.safeParse(validBooking()).success).toBe(true);
  });

  it("rejects null on job_time", () => {
    expect(
      BookingSchema.safeParse(validBooking({ job_time: null })).success
    ).toBe(false);
  });

  it("rejects null on report_notes", () => {
    expect(
      BookingSchema.safeParse(validBooking({ report_notes: null })).success
    ).toBe(false);
  });

  it("rejects null on parent_job_id", () => {
    expect(
      BookingSchema.safeParse(validBooking({ parent_job_id: null })).success
    ).toBe(false);
  });
});

describe("AgreementSchema — null rejection", () => {
  it("accepts the canonical post-fix shape", () => {
    expect(AgreementSchema.safeParse(validAgreement()).success).toBe(true);
  });

  it("rejects null on mobile", () => {
    expect(
      AgreementSchema.safeParse(validAgreement({ mobile: null })).success
    ).toBe(false);
  });

  it("rejects null on terms_text", () => {
    expect(
      AgreementSchema.safeParse(validAgreement({ terms_text: null })).success
    ).toBe(false);
  });

  it("rejects null on signed_date", () => {
    expect(
      AgreementSchema.safeParse(validAgreement({ signed_date: null })).success
    ).toBe(false);
  });
});
