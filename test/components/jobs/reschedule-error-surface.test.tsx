/**
 * RescheduleJobModal — a failed save must be visible.
 *
 * The local-first wrapper now returns a real failure state when the
 * Dexie write or the outbox enqueue throws (previously both aborted
 * silently). This modal was the one surface that received that state and
 * rendered nothing at all: no banner, no message, the modal just sat
 * there looking inert — the same "I pressed the button and nothing
 * happened" shape the wrapper fix was meant to end.
 *
 * The failure is forced at the real boundary (enqueueAction rejecting),
 * not by injecting a state, so this covers the wiring end to end.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (hoisted before imports) ─────────────────────────

vi.mock("@/app/(app)/jobs/[id]/actions", () => ({
  rescheduleJobAction: vi.fn(async () => ({
    success: true,
    errors: {},
    message: null,
  })),
}));

const enqueueMock = vi.fn(async () => ({ id: 1, compacted_ids: [] }));
vi.mock("@/lib/db/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/outbox")>();
  return { ...actual, enqueueAction: () => enqueueMock() };
});

// The advisory lookups hit Dexie indexes we don't care about here.
vi.mock("@/lib/db/lookups", () => ({
  findClashingJobLocal: vi.fn(async () => null),
  findOverlappingBookingsLocal: vi.fn(async () => []),
  findBlockedPeriodsForDateLocal: vi.fn(async () => []),
}));

// ─── Imports (AFTER mocks) ─────────────────────────────────────────

import { RescheduleJobModal } from "@/components/jobs/reschedule-job-modal";
import { db } from "@/lib/db";
import type { Job } from "@/types/database";

const JOB = {
  id: "job-resched-1",
  job_date: "2026-09-01",
  job_time: "09:00",
  job_time_end: "12:00",
} as unknown as Job;

beforeEach(async () => {
  enqueueMock.mockReset();
  enqueueMock.mockResolvedValue({ id: 1, compacted_ids: [] });
  await db.jobs.clear();
  await db.jobs.add({ ...JOB } as Job);
});

describe("RescheduleJobModal — failure is visible", () => {
  it("renders the wrapper's failure message when the enqueue throws", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("outbox unavailable"));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RescheduleJobModal job={JOB} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /save new date/i }));

    const alert = await screen.findByRole("alert");
    // The generic wrapper wording for the queue phase: the row is on the
    // device but will never reach the office.
    expect(alert.textContent ?? "").toMatch(/saved on your device/i);
    expect(alert.textContent ?? "").toMatch(/queue/i);
    // The modal stays open so the operator can retry.
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /save new date/i })
    ).not.toBeDisabled();
  });

  it("renders a failure message when the local Dexie write throws", async () => {
    const updateSpy = vi
      .spyOn(db.jobs, "update")
      .mockRejectedValueOnce(new Error("QuotaExceededError"));
    const user = userEvent.setup();
    render(<RescheduleJobModal job={JOB} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /save new date/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/couldn't save/i);
    // Aborted before the outbox, as the wrapper contract requires.
    expect(enqueueMock).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("shows no alert on a clean save, and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RescheduleJobModal job={JOB} onClose={onClose} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save new date/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
