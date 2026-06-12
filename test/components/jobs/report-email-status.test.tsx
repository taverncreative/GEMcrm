/**
 * L3 email-truth line on the view-only sheet. Four states, pinned:
 *
 *   1. report_emailed_to set → "Report emailed to …" (and no Send-now)
 *   2. queued outbox completion carrying send_email → "queued"
 *   3. no customer address → "no email address on file" + inline add
 *   4. address, never sent → "Send report now"
 *
 * The truth column is server-written; this component must never claim
 * a send that isn't recorded.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { enqueueAction } from "@/lib/db/outbox";
import type { Job, Customer } from "@/types/database";

vi.mock("@/app/(app)/jobs/[id]/report/actions", () => ({
  sendReportNowAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/app/(app)/customers/actions", () => ({
  setCustomerEmailAction: vi.fn(async () => ({ success: true })),
}));

import { ServiceSheetViewOnly } from "@/components/jobs/service-sheet-view-only";

const JOB_ID = "55555555-5555-4555-8555-555555555555";

const baseJob = {
  id: JOB_ID,
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

const customerWithEmail = {
  id: "cust-1",
  name: "Test Customer",
  email: "c@example.test",
} as unknown as Customer;

const customerNoEmail = {
  id: "cust-1",
  name: "Test Customer",
  email: null,
} as unknown as Customer;

beforeEach(async () => {
  await db.outbox.clear();
});

describe("ReportEmailStatus states", () => {
  it("recorded send → 'Report emailed to …', no Send-now button", async () => {
    render(
      <ServiceSheetViewOnly
        job={{ ...baseJob, report_emailed_to: "c@example.test" } as Job}
        site={null}
        customer={customerWithEmail}
      />
    );
    expect(await screen.findByText(/Report emailed to/)).toBeTruthy();
    expect(screen.getByText("c@example.test")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send report now/ })).toBeNull();
  });

  it("queued completion with send_email → 'queued'", async () => {
    await enqueueAction({
      action_name: "completeServiceSheetAction",
      args: { job_id: JOB_ID, finalize: "true", send_email: "true" },
      entity_type: "job",
      entity_id: JOB_ID,
    });
    render(
      <ServiceSheetViewOnly
        job={baseJob}
        site={null}
        customer={customerWithEmail}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/queued/i)).toBeTruthy()
    );
  });

  it("no address → 'no email address on file' + inline add-email", async () => {
    render(
      <ServiceSheetViewOnly job={baseJob} site={null} customer={customerNoEmail} />
    );
    expect(
      await screen.findByText(/no email address on file/i)
    ).toBeTruthy();
    // The inline capture renders (email input present).
    expect(document.querySelector('input[type="email"]')).toBeTruthy();
  });

  it("address on file, never sent → Send report now offered", async () => {
    render(
      <ServiceSheetViewOnly
        job={baseJob}
        site={null}
        customer={customerWithEmail}
      />
    );
    expect(
      await screen.findByRole("button", { name: /Send report now/ })
    ).toBeTruthy();
  });
});
