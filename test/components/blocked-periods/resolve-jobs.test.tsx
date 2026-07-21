/**
 * BlockOutModal — the resolve-jobs-when-blocking flow.
 *
 * Pins the integration the pure unit tests can't:
 *   - jobs falling in the block range are listed with a count, and a
 *     contract-generated visit (agreement_id) is flagged "Contract visit";
 *   - saving with jobs in range and NO actions leaves them untouched (all
 *     KEEP) — the block still saves;
 *   - marking a job CANCEL soft-deletes THAT job on save;
 *   - THE BLOCK ALWAYS SAVES even when a cancel fails — the failure is
 *     surfaced without gating the block.
 *
 * Real Dexie (fake-indexeddb) + real useLocalFirstAction; only the two server
 * actions and the reschedule modal are mocked.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { saveMock, deleteMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("@/app/(app)/blocked-periods/actions", () => ({
  saveBlockedPeriodAction: saveMock,
}));
vi.mock("@/app/(app)/jobs/[id]/actions", () => ({
  deleteJobAction: deleteMock,
}));
vi.mock("@/components/jobs/reschedule-job-modal", () => ({
  RescheduleJobModal: () => <div data-testid="reschedule-modal" />,
}));

import { BlockOutModal } from "@/components/blocked-periods/block-out-modal";
import { db } from "@/lib/db";
import type { Customer, Job, Site } from "@/types/database";

const NOW = "2026-07-01T00:00:00.000Z";

function seedJob(over: Partial<Job> & { id: string; job_date: string }) {
  return db.jobs.add({
    site_id: "site-1",
    job_status: "scheduled",
    call_type: "routine",
    is_archived: false,
    deleted_at: null,
    agreement_id: null,
    job_time: null,
    job_time_end: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Job);
}

async function setRange(start: string, end: string) {
  fireEvent.change(screen.getByLabelText("From"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText(/optional/i), {
    target: { value: end },
  });
}

beforeEach(async () => {
  await db.jobs.clear();
  await db.sites.clear();
  await db.customers.clear();
  await db.blocked_periods.clear();
  await db.outbox.clear();
  saveMock.mockReset().mockResolvedValue({ success: true, errors: {}, message: null });
  deleteMock.mockReset().mockResolvedValue({ success: true });

  await db.customers.add({ id: "cust-1", name: "BSK Ltd" } as unknown as Customer);
  await db.sites.add({ id: "site-1", customer_id: "cust-1" } as unknown as Site);
  await seedJob({ id: "job-plain", job_date: "2026-07-29" });
  await seedJob({ id: "job-contract", job_date: "2026-07-30", agreement_id: "agr-1" });
});

describe("BlockOutModal — resolve-jobs list", () => {
  it("lists jobs in range with a count and flags the contract visit", async () => {
    render(<BlockOutModal onClose={vi.fn()} />);
    await setRange("2026-07-27", "2026-07-31");

    expect(
      await screen.findByText("2 jobs scheduled during this period")
    ).toBeInTheDocument();
    expect(screen.getAllByText("BSK Ltd")).toHaveLength(2);
    // Only the agreement-linked job is flagged.
    expect(screen.getByText("Contract visit")).toBeInTheDocument();
  });

  it("no jobs in range → no list", async () => {
    render(<BlockOutModal onClose={vi.fn()} />);
    await setRange("2026-06-01", "2026-06-03");
    await waitFor(() =>
      expect(screen.queryByText(/scheduled during this period/)).toBeNull()
    );
  });
});

describe("BlockOutModal — save sequencing", () => {
  it("saves the block and leaves jobs untouched when nothing is actioned (all KEEP)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BlockOutModal onClose={onClose} />);
    await setRange("2026-07-27", "2026-07-31");
    await screen.findByText("2 jobs scheduled during this period");
    await user.type(screen.getByLabelText("Reason"), "Benidorm holiday");

    await user.click(screen.getByRole("button", { name: "Block out anyway" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(deleteMock).not.toHaveBeenCalled();
    // Neither job soft-deleted.
    expect((await db.jobs.get("job-plain"))?.deleted_at).toBeFalsy();
    expect((await db.jobs.get("job-contract"))?.deleted_at).toBeFalsy();
  });

  it("soft-deletes only the job marked CANCEL", async () => {
    const user = userEvent.setup();
    render(<BlockOutModal onClose={vi.fn()} />);
    await setRange("2026-07-27", "2026-07-31");
    await screen.findByText("2 jobs scheduled during this period");
    await user.type(screen.getByLabelText("Reason"), "Benidorm holiday");

    // Cancel the plain job (first row's Cancel button).
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    // The last "Cancel" is the modal footer's Cancel; the row cancels precede it.
    await user.click(cancelButtons[0]);
    await user.click(screen.getByRole("button", { name: "Block out anyway" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(deleteMock).toHaveBeenCalledWith("job-plain");
    expect(deleteMock).not.toHaveBeenCalledWith("job-contract");
    await waitFor(async () =>
      expect((await db.jobs.get("job-plain"))?.deleted_at).toBeTruthy()
    );
  });

  it("still saves the block when a cancel fails, and surfaces the failure", async () => {
    deleteMock.mockResolvedValue({ success: false, message: "nope" });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BlockOutModal onClose={onClose} />);
    await setRange("2026-07-27", "2026-07-31");
    await screen.findByText("2 jobs scheduled during this period");
    await user.type(screen.getByLabelText("Reason"), "Benidorm holiday");

    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    await user.click(cancelButtons[0]);
    await user.click(screen.getByRole("button", { name: "Block out anyway" }));

    // Block saved despite the cancel failing…
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    // …and the failure is shown, modal held open (never closed).
    expect(await screen.findByText(/couldn't be cancelled/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
