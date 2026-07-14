/**
 * BookingModal — default the Location to the customer's address, with a
 * "Different site" opt-in.
 *
 * Pins:
 *   - pickPrimarySite chooses the REGISTERED-ADDRESS site, else the OLDEST
 *     site (never the most-recent) — the ordering fix;
 *   - selecting a customer with a site collapses Location to a one-line
 *     summary and REUSES that site (hidden site_id set, mode_site=existing,
 *     no new-site fields, so no bare/new site is created);
 *   - "Different site" toggles the full controls on/off and round-trips;
 *   - a name-only new customer (no usable address) shows the site fields;
 *   - a new customer's typed site address is copied onto their customer
 *     record (applyLocal), so customer and site stay in sync.
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

import {
  BookingModal,
  makeBookingMeta,
  pickPrimarySite,
} from "@/components/bookings/booking-modal";
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

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: "site-1",
    customer_id: "cust-1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: null,
    postcode: null,
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

describe("pickPrimarySite — the ordering fix", () => {
  const older = makeSite({
    id: "old",
    created_at: "2026-01-01T00:00:00.000Z",
    address_line_1: "1 Old Rd",
    town: "Oldtown",
  });
  const newer = makeSite({
    id: "new",
    created_at: "2026-05-01T00:00:00.000Z",
    address_line_1: "2 New Rd",
    town: "Newtown",
  });

  it("no registered address → the OLDEST site (not the most recent)", () => {
    const customer = makeCustomer(); // no address on record
    // Pass newest-first, the order the data layer actually returns.
    const primary = pickPrimarySite(customer, [newer, older]);
    expect(primary?.id).toBe("old");
  });

  it("registered address wins even when it is the newer site", () => {
    const customer = makeCustomer({
      address_line_1: "2 New Rd",
      town: "Newtown",
    });
    const primary = pickPrimarySite(customer, [newer, older]);
    expect(primary?.id).toBe("new");
  });

  it("no sites → null", () => {
    expect(pickPrimarySite(makeCustomer(), [])).toBeNull();
  });
});

describe("BookingModal — Location collapses to the customer's address", () => {
  it("one site → collapsed summary, reuses that site, shows no site fields", async () => {
    const customer = makeCustomer({ id: "c-1" });
    await db.customers.put(customer);
    await db.sites.put(
      makeSite({
        id: "s-1",
        customer_id: "c-1",
        address_line_1: "12 High St",
        town: "Testford",
        postcode: "TF1 1AA",
      })
    );

    const { container } = render(
      <BookingModal open onClose={() => {}} presetCustomer={customer} />
    );

    await waitFor(() =>
      expect(
        screen.getByText(/using the customer's address/i)
      ).toBeInTheDocument()
    );
    // The one-line summary shows the address; the manual fields are hidden.
    expect(screen.getByText(/12 High St, Testford, TF1 1AA/)).toBeInTheDocument();
    expect(container.querySelector("#bn-site_line1")).toBeNull();

    // Reuse: the existing site id is submitted, mode_site=existing → the
    // server takes the reuse branch and mints no new/bare site.
    expect(hidden(container, "site_id")).toBe("s-1");
    expect(hidden(container, "mode_site")).toBe("existing");
    expect(hidden(container, "site_line1")).toBe("");
  });

  it("'Different site' reveals the controls and round-trips back", async () => {
    const customer = makeCustomer({ id: "c-1" });
    await db.customers.put(customer);
    await db.sites.put(
      makeSite({
        id: "s-1",
        customer_id: "c-1",
        address_line_1: "12 High St",
        town: "Testford",
        postcode: "TF1 1AA",
      })
    );

    const { container } = render(
      <BookingModal open onClose={() => {}} presetCustomer={customer} />
    );
    await waitFor(() =>
      expect(
        screen.getByText(/using the customer's address/i)
      ).toBeInTheDocument()
    );

    // Tick → the Existing/New controls appear.
    await userEvent.click(
      screen.getByRole("checkbox", { name: /different site/i })
    );
    expect(
      screen.getByRole("button", { name: /^\+ New$/ })
    ).toBeInTheDocument();

    // Untick → collapses back to the same reused site.
    await userEvent.click(
      screen.getByRole("checkbox", { name: /different site/i })
    );
    await waitFor(() =>
      expect(
        screen.getByText(/using the customer's address/i)
      ).toBeInTheDocument()
    );
    expect(hidden(container, "site_id")).toBe("s-1");
    expect(hidden(container, "mode_site")).toBe("existing");
  });

  it("name-only new customer (no usable address) → site fields are shown", async () => {
    const { container } = render(<BookingModal open onClose={() => {}} />);

    const field = (await screen.findByPlaceholderText(
      /type a customer name/i
    )) as HTMLInputElement;
    await userEvent.type(field, "Walk In");

    // Nothing to default to → no summary, the manual fields are present.
    expect(screen.queryByText(/using the customer's address/i)).toBeNull();
    const line1 = container.querySelector<HTMLInputElement>("#bn-site_line1");
    expect(line1).not.toBeNull();

    await userEvent.type(line1!, "9 New Lane");
    expect(hidden(container, "mode_customer")).toBe("new");
    expect(hidden(container, "site_line1")).toBe("9 New Lane");
  });
});

describe("makeBookingMeta — new customer inherits the site address", () => {
  it("applyLocal copies the entered site address onto the customer record", async () => {
    const meta = makeBookingMeta();
    const f = new FormData();
    Object.entries({
      mode_customer: "new",
      mode_site: "new",
      customer_name: "New Cust",
      customer_type: "domestic",
      site_line1: "5 Elm Rd",
      site_town: "Elmville",
      site_postcode: "el1 2ab",
      job_date: "2026-07-01",
    }).forEach(([k, v]) => f.append(k, v));

    const input = meta.parseInput!(f)!;
    await meta.applyLocal(input);

    const cust = await db.customers.get(input.newCustomerId!);
    expect(cust!.address_line_1).toBe("5 Elm Rd");
    expect(cust!.town).toBe("Elmville");
    expect(cust!.postcode).toBe("EL1 2AB");

    // Site carries the same address (they stay in sync).
    const site = await db.sites.get(input.newSiteId!);
    expect(site!.address_line_1).toBe("5 Elm Rd");
    expect(site!.town).toBe("Elmville");
  });
});
