/**
 * BookingModal — service-sheet intent (create a sheet from scratch).
 *
 * Pins the intent-specific behaviour:
 *   - relabelled ("New service sheet" / "Start sheet"), no arrival-window
 *     picker, no clash advisory;
 *   - the scheduling clash guard is suppressed, so a save proceeds even when
 *     a same-site/date/type job already exists;
 *   - on save the backing job is written to Dexie as `in_progress` and the
 *     operator is navigated to that job's /complete fill flow.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));
vi.mock("@/app/(app)/bookings/actions", () => ({
  createQuickBookingAction: vi.fn(async () => ({
    success: true,
    errors: {},
    message: null,
  })),
}));
vi.mock("@/components/ui/time-window-picker", () => ({
  TimeWindowPicker: () => <div data-testid="twp" />,
}));

import { BookingModal } from "@/components/bookings/booking-modal";
import { db } from "@/lib/db";
import type { Customer, Site } from "@/types/database";

const NOW = "2026-06-01T10:00:00.000Z";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    name: "Test Customer",
    company_name: null,
    email: null,
    phone: null,
    customer_type: "domestic",
    google_review_received: false,
    review_request_snoozed_until: null,
    review_email_sent_at: null,
    mobile: null,
    position: null,
    address: null,
    address_line_1: "1 Reg St",
    address_line_2: null,
    town: "Regtown",
    county: null,
    postcode: "RG1 1AA",
    website: null,
    notes: null,
    annual_contract_value: null,
    ...overrides,
  };
}

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: "site-1",
    customer_id: "cust-1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    address_line_1: "1 Reg St",
    address_line_2: null,
    town: "Regtown",
    county: null,
    postcode: "RG1 1AA",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
  pushMock.mockClear();
  await db.customers.put(makeCustomer());
  await db.sites.put(makeSite());
});

describe("BookingModal — service-sheet intent", () => {
  it("relabels and drops the scheduling controls", async () => {
    render(
      <BookingModal
        open
        onClose={() => {}}
        intent="service-sheet"
        presetCustomer={makeCustomer()}
      />
    );
    expect(await screen.findByText("New service sheet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start sheet/ })
    ).toBeInTheDocument();
    // No arrival-window picker, and its label suffix is gone.
    expect(screen.queryByTestId("twp")).toBeNull();
    expect(screen.queryByText(/Arrival window/)).toBeNull();
  });

  it("suppresses the clash guard, writes an in_progress job, lands on /complete", async () => {
    // A same-site job on the same date + call type would block a BOOKING,
    // but a service sheet documents a past visit, so it must not block.
    await db.jobs.put({
      id: "existing",
      site_id: "site-1",
      job_date: "2026-07-02",
      call_type: "callout",
      job_status: "scheduled",
    } as unknown as import("@/types/database").Job);

    render(
      <BookingModal
        open
        onClose={() => {}}
        intent="service-sheet"
        presetCustomer={makeCustomer()}
      />
    );

    // Wait for the customer's site to default in (Location collapses).
    await screen.findByText(/Using the customer's address/i);

    // Back-date to the clashing date and pick the clashing call type.
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await userEvent.clear(dateInput);
    await userEvent.type(dateInput, "2026-07-02");
    await userEvent.selectOptions(
      screen.getByLabelText(/Call Type/),
      "callout"
    );

    await userEvent.click(screen.getByRole("button", { name: /Start sheet/ }));

    // Navigated to the new job's fill flow (not blocked by the clash).
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const dest = pushMock.mock.calls[0][0] as string;
    expect(dest).toMatch(/^\/jobs\/.+\/complete$/);

    // The backing job was written to Dexie as in_progress on the real site.
    const jobId = dest.split("/")[2];
    const job = await db.jobs.get(jobId);
    expect(job?.job_status).toBe("in_progress");
    expect(job?.site_id).toBe("site-1");
    expect(job?.job_date).toBe("2026-07-02");
  });
});
