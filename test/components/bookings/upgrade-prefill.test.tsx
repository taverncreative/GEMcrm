/**
 * Draft upgrade — customer-step defaulting + smart contact match
 * (Track 2, Half 2).
 *
 * When the BookingModal opens in attach-to-draft mode (draftJobId set) it
 * reads the draft's captured caller name into the SINGLE customer field
 * (type-to-select-or-create) and runs a local (Dexie) match. This suite pins:
 *
 *   - prefill: the captured name seeds the single field; the captured phone
 *     flows to the new customer via the hidden input
 *   - strong match (exact name): switches to existing + preselected
 *   - strong match (phone): partial name + matching phone → existing
 *   - weak match (partial name): single field stays prefilled + inline hint
 *   - no match: single field prefilled, treated as new, no hint
 *   - no captured contact: single field blank, no hint
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

function renderUpgrade(contact: { name?: string; phone?: string }) {
  return render(
    <BookingModal
      open
      onClose={() => {}}
      draftJobId="d-1"
      presetCaptureNote="ZZ test"
      presetJobDate="2026-06-20"
      presetWindow={{ start: "", end: "" }}
      presetContactName={contact.name}
      presetContactPhone={contact.phone}
    />
  );
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("Draft upgrade — customer-step smart default", () => {
  it("no match → captured name prefilled into the single field, treated as new, no hint", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Bob Smith" }));

    const { container } = renderUpgrade({
      name: "Sarah Jones",
      phone: "07700 900000",
    });

    // The single customer field is prefilled with the captured name.
    const field = (await screen.findByPlaceholderText(
      /type a customer name/i
    )) as HTMLInputElement;
    expect(field.value).toBe("Sarah Jones");
    // No match → not switched to an existing customer (no "Change"), no hint.
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
    expect(screen.queryByText(/Looks like an existing customer/i)).toBeNull();
    // The captured phone still flows to the new customer via the hidden input.
    expect(
      (container.querySelector(
        'input[name="customer_phone"]'
      ) as HTMLInputElement).value
    ).toBe("07700 900000");
  });

  it("no captured contact → the single field is blank, no hint", async () => {
    const { container } = renderUpgrade({});

    const field = (await screen.findByPlaceholderText(
      /type a customer name/i
    )) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
    expect(screen.queryByText(/Looks like an existing customer/i)).toBeNull();
    expect(
      (container.querySelector(
        'input[name="customer_phone"]'
      ) as HTMLInputElement).value
    ).toBe("");
  });

  it("strong match (exact name) → switches to EXISTING + preselected", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "ZZ Sarah" }));

    renderUpgrade({ name: "ZZ Sarah", phone: "07700 900000" });

    // Flips to existing: the selected-customer box + Change button appear,
    // and the new-customer form (Customer type) is gone.
    expect(
      await screen.findByRole("button", { name: /change/i })
    ).toBeInTheDocument();
    expect(screen.getByText("ZZ Sarah")).toBeInTheDocument();
    expect(screen.queryByText("Customer type")).toBeNull();
  });

  it("strong match (phone) → partial name + matching phone preselects existing", async () => {
    await db.customers.put(
      makeCustomer({ id: "c-1", name: "Sarah Smith", phone: "07700900000" })
    );

    renderUpgrade({ name: "Sarah", phone: "07700 900000" });

    expect(
      await screen.findByRole("button", { name: /change/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Sarah Smith")).toBeInTheDocument();
    expect(screen.queryByText("Customer type")).toBeNull();
  });

  it("weak match (partial name) → single field prefilled + inline hint; tapping uses them", async () => {
    await db.customers.put(
      makeCustomer({ id: "c-1", name: "Acme Pest Co", company_name: "Acme Pest Co" })
    );

    renderUpgrade({ name: "Acme" });

    // Hint surfaces the candidate; the single field stays prefilled and is
    // NOT yet switched to an existing customer (no "Change").
    expect(
      await screen.findByText(/Looks like an existing customer/i)
    ).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText(/type a customer name/i) as HTMLInputElement)
        .value
    ).toBe("Acme");
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();

    // Tapping "Use them" switches to the existing customer.
    await userEvent.click(screen.getByRole("button", { name: /use them/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /change/i })
      ).toBeInTheDocument();
    });
  });
});
