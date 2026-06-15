/**
 * BookingModal — create-mode customer combobox (single field).
 *
 * The New Booking modal has ONE customer field (type-to-select-or-create),
 * not existing/new tabs. This suite pins the two paths:
 *
 *   - type a name that matches nobody → it's treated as a NEW customer
 *     (mode_customer="new", customer_name = the typed text, no customer_id),
 *     and a "Create new customer '…'" cue makes that explicit;
 *   - type a name that matches an existing customer → the match surfaces to
 *     pick; picking it uses that EXISTING customer (mode_customer="existing",
 *     customer_id set, customer_name cleared) — no accidental duplicate.
 *
 * The match is a Dexie read (offline) — no server. createQuickBookingAction
 * + TimeWindowPicker are stubbed (the action drags in next/headers; the
 * picker is irrelevant to the customer step).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/app/(app)/bookings/actions", () => ({
  createQuickBookingAction: vi.fn(),
}));
vi.mock("@/components/ui/time-window-picker", () => ({
  TimeWindowPicker: () => <div data-testid="twp" />,
}));

import { BookingModal } from "@/components/bookings/booking-modal";
import { db } from "@/lib/db";
import type { Customer } from "@/types/database";

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
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: null,
    postcode: null,
    website: null,
    notes: null,
    annual_contract_value: null,
    ...overrides,
  };
}

function hidden(container: HTMLElement, name: string): string {
  return (
    container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ??
    "<<missing>>"
  );
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("BookingModal — create-mode customer combobox", () => {
  it("typing a brand-new name → treated as a NEW customer (cue shown, no duplicate)", async () => {
    // A customer who does NOT match what we'll type.
    await db.customers.put(makeCustomer({ id: "c-1", name: "Bob Smith" }));

    const { container } = render(<BookingModal open onClose={() => {}} />);

    const field = (await screen.findByPlaceholderText(
      /type a customer name/i
    )) as HTMLInputElement;
    await userEvent.type(field, "James Potter");

    // The "create new" cue makes the create-vs-select choice explicit.
    await waitFor(() => {
      expect(container.textContent).toContain("Create new customer");
    });

    // Not switched to an existing customer (no pick happened).
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();

    // Hidden contract: a NEW customer carrying the typed name, no id.
    expect(hidden(container, "mode_customer")).toBe("new");
    expect(hidden(container, "customer_name")).toBe("James Potter");
    expect(hidden(container, "customer_id")).toBe("");
  });

  it("typing an existing name → match surfaces; picking it uses the EXISTING customer", async () => {
    await db.customers.put(
      makeCustomer({
        id: "c-1",
        name: "Acme Pest Co",
        company_name: "Acme Pest Co",
      })
    );

    const { container } = render(<BookingModal open onClose={() => {}} />);

    const field = (await screen.findByPlaceholderText(
      /type a customer name/i
    )) as HTMLInputElement;
    await userEvent.type(field, "Acme");

    // The existing customer surfaces as a pickable match (debounced Dexie read).
    const match = await screen.findByRole("button", { name: /Acme Pest Co/i });
    await userEvent.click(match);

    // Picked → selected card + Change button; the field is replaced.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /change/i })
      ).toBeInTheDocument();
    });

    // Hidden contract: an EXISTING customer addressed by id, no new name.
    expect(hidden(container, "mode_customer")).toBe("existing");
    expect(hidden(container, "customer_id")).toBe("c-1");
    expect(hidden(container, "customer_name")).toBe("");
  });
});
