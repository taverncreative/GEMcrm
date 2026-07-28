/**
 * Job report PDF — the Environmental Risk Assessment section.
 *
 * The ERA applies to a minority of jobs (toxic bait used outdoors), so the
 * section must be ABSENT ENTIRELY when jobs.environmental_comments is null:
 * the vast majority of customer PDFs have to render exactly as they did
 * before the feature existed. Pins the real template, not a stand-in.
 */
import { describe, it, expect } from "vitest";
import { renderJobReportHtml } from "@/lib/pdf/templates/job-report-template";
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
    environmental_comments: null,
    products_used: [],
    pesticides_used: null,
    ...over,
  } as unknown as Job;
}

const ERA_LABEL = "Environmental Risk Assessment";

describe("job report PDF — ERA section", () => {
  it("is OMITTED entirely when there is no ERA (the common case)", () => {
    const html = renderJobReportHtml({
      job: baseJob({ environmental_comments: null }),
      site,
      customer,
    });
    expect(html).not.toContain(ERA_LABEL);
    // The ordinary risk assessment is untouched.
    expect(html).toContain("Risk Assessment Comments");
    expect(html).toContain("No hazards");
  });

  it("renders under Risk Assessment when filled", () => {
    const era = "Bait secured in tamper-resistant stations away from drains.";
    const html = renderJobReportHtml({
      job: baseJob({ environmental_comments: era }),
      site,
      customer,
    });
    expect(html).toContain(ERA_LABEL);
    expect(html).toContain(era);
    // Placement: inside the Risk Assessment section, after the risk comments.
    const riskIdx = html.indexOf("Risk Assessment Comments");
    const eraIdx = html.indexOf(ERA_LABEL);
    const photosIdx = html.indexOf("Additional Photos");
    expect(riskIdx).toBeGreaterThan(-1);
    expect(eraIdx).toBeGreaterThan(riskIdx);
    if (photosIdx > -1) expect(eraIdx).toBeLessThan(photosIdx);
  });

  it("escapes the ERA text like every other customer-facing field", () => {
    const html = renderJobReportHtml({
      job: baseJob({
        environmental_comments: '<script>alert("x")</script> & drains',
      }),
      site,
      customer,
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&amp; drains");
  });

  it("an empty string is treated as no ERA", () => {
    const html = renderJobReportHtml({
      job: baseJob({ environmental_comments: "" }),
      site,
      customer,
    });
    expect(html).not.toContain(ERA_LABEL);
  });
});
