/**
 * Job report PDF — "Products Used" is CUSTOMER-FACING and must show the
 * CHEMICAL name only, NEVER the brand (migration 047). This pins the actual
 * PDF template (renderJobReportHtml), the real customer document, so a future
 * edit can't reintroduce a brand leak.
 */
import { describe, it, expect } from "vitest";
import { renderJobReportHtml } from "@/lib/pdf/templates/job-report-template";
import { CHEMICAL_FALLBACK } from "@/lib/products/render";
import type { Job, Customer, Site } from "@/types/database";

const customer = { name: "John Lally", company_name: null } as unknown as Customer;
const site = {
  address_line_1: "1 Industrial Way",
  town: "Testford",
  postcode: "TF1 1AA",
} as unknown as Site;

function baseJob(over: Partial<Job>): Job {
  return {
    id: "j1",
    job_date: "2026-07-17",
    call_type: "routine",
    pest_species: ["Rats"],
    findings: "Droppings in store room",
    recommendations: "Bait stations installed",
    method_used: ["Rodenticide Used"],
    risk_level: "low",
    risk_comments: "No hazards",
    products_used: [],
    pesticides_used: null,
    ...over,
  } as unknown as Job;
}

describe("job report PDF — Products Used is chemical-only", () => {
  it("shows chemical names + quantities, and NEVER the brand", () => {
    const html = renderJobReportHtml({
      job: baseJob({
        products_used: [
          {
            product_id: "p1",
            brand_name: "Vulcan Dust",
            chemical_name: "permethrin 0.5% dust",
            quantity: "150g",
          },
          {
            product_id: null,
            brand_name: "Ficam D",
            chemical_name: "bendiocarb 1% dust",
            quantity: "2 puffs",
          },
        ],
      }),
      site,
      customer,
    });

    // Customer-facing label + the chemical names appear.
    expect(html).toContain("Products Used");
    expect(html).toContain("permethrin 0.5% dust");
    expect(html).toContain("bendiocarb 1% dust");
    expect(html).toContain("150g");
    expect(html).toContain("2 puffs");

    // The brands must NEVER appear anywhere in the customer document.
    expect(html).not.toContain("Vulcan Dust");
    expect(html).not.toContain("Ficam D");
  });

  it("a product with no chemical shows the neutral fallback, not the brand", () => {
    const html = renderJobReportHtml({
      job: baseJob({
        products_used: [
          {
            product_id: "p1",
            brand_name: "SecretBrand",
            chemical_name: null,
            quantity: "10g",
          },
        ],
      }),
      site,
      customer,
    });
    expect(html).toContain(CHEMICAL_FALLBACK);
    expect(html).not.toContain("SecretBrand");
  });

  it("old sheet (legacy free text, no structured rows) renders verbatim", () => {
    const html = renderJobReportHtml({
      job: baseJob({
        products_used: [],
        pesticides_used: "Bromadiolone 0.005% blocks",
      }),
      site,
      customer,
    });
    expect(html).toContain("Bromadiolone 0.005% blocks");
  });

  it("zero products (survey visit) → no Products Used field in the doc", () => {
    const html = renderJobReportHtml({
      job: baseJob({ products_used: [], pesticides_used: null }),
      site,
      customer,
    });
    expect(html).not.toContain("Products Used");
  });
});
