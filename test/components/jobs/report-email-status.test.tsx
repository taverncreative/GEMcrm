/**
 * L3 email panel on the view-only sheet — the multi-recipient send.
 * States, pinned:
 *
 *   1. report_emailed_to set → a light "Already sent to …" note AND a
 *      re-send is still offered (guard relaxed): the recipients field is
 *      pre-filled with the last-sent list and the button reads "Send again".
 *   2. queued outbox completion carrying send_email → "queued" (the
 *      deferred single-recipient path; unchanged).
 *   3. no customer email → the recipients field is offered empty, "Send
 *      report". The field is authoritative now (no separate email gate).
 *   4. email on file, never sent → field pre-filled with it, "Send report".
 *
 * The truth column is server-written; the note never claims a send that
 * isn't recorded, but a re-send to a new list is always allowed.
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
  it("recorded send → 'Already sent to …' note, but re-send still offered", async () => {
    render(
      <ServiceSheetViewOnly
        job={{ ...baseJob, report_emailed_to: "c@example.test" } as Job}
        site={null}
        customer={customerWithEmail}
      />
    );
    expect(await screen.findByText(/Already sent to/)).toBeTruthy();
    expect(screen.getByText("c@example.test")).toBeTruthy();
    // Guard relaxed: a re-send is offered, pre-filled with the last list.
    const button = screen.getByRole("button", { name: /Send again/ });
    expect(button).toBeTruthy();
    const input = screen.getByLabelText(/Email report to/) as HTMLInputElement;
    expect(input.value).toBe("c@example.test");
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
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeTruthy());
  });

  it("no email → an empty recipients field is offered ('Send report')", async () => {
    render(
      <ServiceSheetViewOnly
        job={baseJob}
        site={null}
        customer={customerNoEmail}
      />
    );
    const input = (await screen.findByLabelText(
      /Email report to/
    )) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(
      screen.getByRole("button", { name: /Send report/ })
    ).toBeTruthy();
  });

  it("address on file, never sent → field pre-filled, 'Send report'", async () => {
    render(
      <ServiceSheetViewOnly
        job={baseJob}
        site={null}
        customer={customerWithEmail}
      />
    );
    const input = (await screen.findByLabelText(
      /Email report to/
    )) as HTMLInputElement;
    expect(input.value).toBe("c@example.test");
    expect(
      screen.getByRole("button", { name: /Send report/ })
    ).toBeTruthy();
  });
});
