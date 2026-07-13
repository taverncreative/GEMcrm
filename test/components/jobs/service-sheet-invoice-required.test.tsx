/**
 * Service sheet "Invoice required" checkbox (migration 041) → needs_invoice.
 *
 * Pins that ticking the checkbox flows through the optimistic completion:
 *   - the combined outbox entry's args carry invoice_required = "true";
 *   - completeServiceSheetMeta.applyLocal writes needs_invoice = true onto
 *     the local Dexie job row (so the homepage checklist picks it up
 *     offline, before any sync).
 * And that leaving it unticked yields needs_invoice = false.
 *
 * Same mock shape as service-sheet-form.test.tsx (server action + visual
 * children stubbed).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const completeFn = vi.fn();
vi.mock("@/app/(app)/jobs/[id]/complete/actions", () => ({
  completeServiceSheetAction: (...args: unknown[]) => completeFn(...args),
  approveServiceSheetAction: vi.fn(),
}));

vi.mock("@/components/ui/signature-pad", () => ({
  SignaturePad: ({
    label,
    onSignature,
  }: {
    label: string;
    onSignature: (s: string) => void;
    onClear: () => void;
  }) => (
    <button
      type="button"
      data-testid={`sigpad-${label || "tech"}`}
      onClick={() => onSignature("data:image/png;base64,STUB")}
    >
      Mock sigpad — {label || "tech"}
    </button>
  ),
}));

vi.mock("@/components/ui/photo-upload", () => ({
  PhotoUpload: () => <div data-testid="mock-photo-upload" />,
}));

import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { db } from "@/lib/db";
import type { Job } from "@/types/database";

const JOB_ID = "test-job-invoice";

beforeEach(async () => {
  completeFn.mockReset();
  await db.outbox.clear();
  await db.service_sheet_drafts.clear();
  await db.jobs.clear();
  // Seed the job so applyLocal's db.jobs.update has a row to mutate.
  await db.jobs.add({
    id: JOB_ID,
    job_status: "in_progress",
    needs_invoice: false,
    is_archived: false,
    deleted_at: null,
  } as unknown as Job);
});

async function fillAllSteps(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Routine"));
  await user.click(screen.getByRole("button", { name: "Mice" }));
  await user.type(screen.getByLabelText(/^Findings/i), "Droppings");
  await user.type(screen.getByLabelText(/^Recommendations/i), "Bait");
  await user.click(screen.getByRole("button", { name: "Rodenticide Used" }));
  await user.type(screen.getByLabelText(/^Pesticides Used/i), "Bromadiolone");
  await user.type(
    screen.getByLabelText(/Risk Assessment Comments/i),
    "No special hazards"
  );
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByTestId("sigpad-tech"));
}

describe("Service sheet — Invoice required checkbox", () => {
  it("ticked → outbox arg + needs_invoice = true on the local job", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId={JOB_ID} />);

    await fillAllSteps(user);
    await user.click(screen.getByLabelText(/Invoice required/i));

    await user.click(screen.getByRole("button", { name: /Review & Complete/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Review & Complete/ })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    expect(args.invoice_required).toBe("true");

    const job = await db.jobs.get(JOB_ID);
    expect(job?.needs_invoice).toBe(true);
  });

  it("unticked → needs_invoice stays false", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId={JOB_ID} />);

    await fillAllSteps(user);
    // do NOT tick "Invoice required"
    await user.click(screen.getByRole("button", { name: /Review & Complete/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Review & Complete/ })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    expect(args.invoice_required ?? "").toBe("");

    const job = await db.jobs.get(JOB_ID);
    expect(job?.needs_invoice).toBe(false);
  });
});
