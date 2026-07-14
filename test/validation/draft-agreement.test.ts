/**
 * DraftAgreementSchema — the unsigned-proposal variant. Signatures are
 * optional; every other proposal field stays required so the review copy
 * the customer reads is complete. The full AgreementSchema still requires
 * signatures (the sign-now path is unchanged).
 */
import { describe, it, expect } from "vitest";
import {
  AgreementSchema,
  DraftAgreementSchema,
} from "@/lib/validation/agreement";

const base = {
  customer_id: "c1",
  site_id: "s1",
  reference_number: "GEM-2026-001",
  contact_name: "Acme Cafe Ltd",
  contact_email: "owner@acme.test",
  contact_phone: "01234 567890",
  invoice_address: "5 Cafe Row, Testford",
  start_date: "2026-07-01",
  visit_frequency: "12",
  contract_value: "1200",
  pest_species: ["Rats"],
  callout_terms: "48-hour response",
  terms_text: "1. THE CLIENT\nThe terms.",
};

describe("DraftAgreementSchema", () => {
  it("accepts the full proposal WITHOUT signatures", () => {
    const r = DraftAgreementSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("still requires the proposal fields (missing reference blocks)", () => {
    const r = DraftAgreementSchema.safeParse({ ...base, reference_number: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "reference_number")).toBe(
        true
      );
    }
  });

  it("still requires at least one pest species", () => {
    const r = DraftAgreementSchema.safeParse({ ...base, pest_species: [] });
    expect(r.success).toBe(false);
  });
});

describe("AgreementSchema (sign-now) still requires signatures", () => {
  it("rejects the same input when signatures are absent", () => {
    const r = AgreementSchema.safeParse(base);
    expect(r.success).toBe(false);
    if (!r.success) {
      const keys = r.error.issues.map((i) => i.path[0]);
      expect(keys).toEqual(
        expect.arrayContaining([
          "client_signature",
          "gem_signature",
          "client_signatory_name",
        ])
      );
    }
  });

  it("accepts once the signatures are present", () => {
    const r = AgreementSchema.safeParse({
      ...base,
      client_signature: "data:image/png;base64,AAAA",
      gem_signature: "data:image/png;base64,BBBB",
      client_signatory_name: "Jane Owner",
    });
    expect(r.success).toBe(true);
  });
});
