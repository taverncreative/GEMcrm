/**
 * ERA on the view-only service sheet.
 *
 * The Field helper renders a placeholder for empty values, so the ERA row is
 * explicitly guarded: a sheet with no assessment must show NO ERA row at all,
 * not a blank one. Almost every sheet has no ERA, so an unguarded Field would
 * add dead furniture to all of them.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import type { Job, Customer } from "@/types/database";

vi.mock("@/app/(app)/jobs/[id]/report/actions", () => ({
  sendReportNowAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/app/(app)/customers/actions", () => ({
  setCustomerEmailAction: vi.fn(async () => ({ success: true })),
}));

import { ServiceSheetViewOnly } from "@/components/jobs/service-sheet-view-only";

const baseJob = {
  id: "66666666-6666-4666-8666-666666666666",
  site_id: "site-1",
  job_status: "completed",
  job_date: "2026-06-10",
  pest_species: ["Rat"],
  method_used: ["Inspection"],
  findings: "f",
  recommendations: "r",
  pesticides_used: "None",
  risk_level: "low",
  risk_comments: "none",
  environmental_comments: null,
  photo_urls: [],
  client_present: false,
  technician_signature_url: null,
  client_signature_url: null,
  client_name: null,
  report_notes: null,
  call_type: "routine",
  report_emailed_to: null,
  report_emailed_at: null,
} as unknown as Job;

const customer = {
  id: "cust-1",
  name: "Test Customer",
  email: "c@example.test",
} as unknown as Customer;

const ERA_LABEL = /Environmental risk assessment/i;

beforeEach(async () => {
  await db.outbox.clear();
});

describe("view-only sheet — ERA row", () => {
  it("shows NO ERA row when the job has none", () => {
    render(
      <ServiceSheetViewOnly job={baseJob} site={null} customer={customer} />
    );
    // The ordinary risk fields still render.
    expect(screen.getByText("Risk comments")).toBeTruthy();
    // No ERA label, and therefore no blank placeholder row.
    expect(screen.queryByText(ERA_LABEL)).toBeNull();
  });

  it("shows the ERA row when the job has one", () => {
    const era = "Bait secured in tamper-resistant stations.";
    render(
      <ServiceSheetViewOnly
        job={{ ...baseJob, environmental_comments: era } as Job}
        site={null}
        customer={customer}
      />
    );
    expect(screen.getByText(ERA_LABEL)).toBeTruthy();
    expect(screen.getByText(era)).toBeTruthy();
  });

  it("treats an empty string as no ERA", () => {
    render(
      <ServiceSheetViewOnly
        job={{ ...baseJob, environmental_comments: "" } as Job}
        site={null}
        customer={customer}
      />
    );
    expect(screen.queryByText(ERA_LABEL)).toBeNull();
  });
});
