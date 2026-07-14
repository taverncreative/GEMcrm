/**
 * renderAgreementHtml review mode — the unsigned copy the customer reads
 * before signing. It must: show the "FOR REVIEW, NOT YET SIGNED" banner,
 * replace the signature images with a "To be signed on the visit"
 * placeholder (even if signature URLs exist), and omit the signed date.
 * Signed mode (default) is unchanged: it renders the signature images.
 */
import { describe, it, expect } from "vitest";
import { renderAgreementHtml } from "@/lib/pdf/templates/agreement-template";
import type { Agreement, Customer, Site } from "@/types/database";

const GEM_SIG = "https://example.test/agreements/a1/gem.png";
const CLIENT_SIG = "https://example.test/agreements/a1/client.png";

const agreement = {
  id: "a1",
  reference_number: "GEM-2026-001",
  start_date: "2026-07-01",
  signed_date: "2026-07-02",
  visit_frequency: 12,
  contract_value: 1200,
  pest_species: ["Rats"],
  callout_terms: "48-hour response",
  terms_text: "1. THE CLIENT\nThe terms.",
  contact_name: "Acme Cafe Ltd",
  contact_email: "owner@acme.test",
  contact_phone: "01234 567890",
  mobile: null,
  invoice_address: "5 Cafe Row, Testford",
  client_signature_url: CLIENT_SIG,
  gem_signature_url: GEM_SIG,
  client_signatory_name: "Jane Owner",
} as unknown as Agreement;

const customer = { name: "Acme", company_name: "Acme Cafe Ltd" } as unknown as Customer;
const site = {
  address_line_1: "5 Cafe Row",
  town: "Testford",
  postcode: "TF3 3CC",
} as unknown as Site;

describe("renderAgreementHtml — review mode", () => {
  const review = renderAgreementHtml({ agreement, customer, site, mode: "review" });

  it("shows the review banner", () => {
    expect(review).toContain("FOR REVIEW, NOT YET SIGNED");
  });

  it("replaces signatures with the review placeholder", () => {
    expect(review).toContain("To be signed on the visit");
    expect(review).not.toContain(GEM_SIG);
    expect(review).not.toContain(CLIENT_SIG);
  });

  it("omits the signed date", () => {
    // The signed_date value must not render anywhere in review mode.
    expect(review).not.toContain("2 Jul 2026");
  });

  it("still renders the personalised details + terms", () => {
    expect(review).toContain("Acme Cafe Ltd");
    expect(review).toContain("THE CLIENT");
  });
});

describe("renderAgreementHtml — signed mode (default) unchanged", () => {
  const signed = renderAgreementHtml({ agreement, customer, site });

  it("renders the signature images and no review banner", () => {
    expect(signed).toContain(GEM_SIG);
    expect(signed).toContain(CLIENT_SIG);
    expect(signed).not.toContain("FOR REVIEW");
    expect(signed).not.toContain("To be signed on the visit");
  });
});
