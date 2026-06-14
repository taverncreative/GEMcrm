/**
 * Draft upgrade — customer-step defaulting + smart contact match
 * (Track 2, Half 2).
 *
 * When the BookingModal opens in attach-to-draft mode (draftJobId set) it
 * reads the draft's captured caller name/phone and DEFAULTS the customer
 * step: "new" + prefilled, unless a local (Dexie) customer match says
 * otherwise. This suite pins:
 *
 *   - prefill: new-customer name + phone seeded from the captured contact
 *   - strong match (exact name): switches to existing + preselected
 *   - strong match (phone): partial name + matching phone → existing
 *   - weak match (partial name): stays "new" (prefilled) + inline hint
 *   - no match: "new", prefilled, no hint
 *   - no captured contact: "new", blank, no hint
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
  it("no match → defaults to NEW, prefilled from the captured contact, no hint", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Bob Smith" }));

    renderUpgrade({ name: "Sarah Jones", phone: "07700 900000" });

    // New-customer form is shown, prefilled. (Query the VISIBLE inputs by
    // placeholder/label — the modal also mirrors state into hidden inputs,
    // which getByDisplayValue would double-match.)
    const nameInput = (await screen.findByPlaceholderText(
      "Full name"
    )) as HTMLInputElement;
    expect(nameInput.value).toBe("Sarah Jones");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe(
      "07700 900000"
    );
    expect(screen.getByText("Customer type")).toBeInTheDocument(); // new-mode only
    // No existing-customer match → no hint.
    expect(screen.queryByText(/Looks like an existing customer/i)).toBeNull();
  });

  it("no captured contact → defaults to NEW, blank, no hint", async () => {
    renderUpgrade({});

    const nameInput = (await screen.findByPlaceholderText(
      "Full name"
    )) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    const phoneInput = screen.getByLabelText("Phone") as HTMLInputElement;
    expect(phoneInput.value).toBe("");
    expect(screen.queryByText(/Looks like an existing customer/i)).toBeNull();
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

  it("weak match (partial name) → stays NEW (prefilled) + shows the hint; tapping uses them", async () => {
    await db.customers.put(
      makeCustomer({ id: "c-1", name: "Acme Pest Co", company_name: "Acme Pest Co" })
    );

    renderUpgrade({ name: "Acme" });

    // Hint surfaces the candidate; form stays new + prefilled.
    expect(
      await screen.findByText(/Looks like an existing customer/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Customer type")).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText("Full name") as HTMLInputElement).value
    ).toBe("Acme");

    // Tapping "Use them" switches to the existing customer.
    await userEvent.click(screen.getByRole("button", { name: /use them/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /change/i })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Customer type")).toBeNull();
  });
});
