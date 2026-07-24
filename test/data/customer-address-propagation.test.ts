/**
 * propagateAddressToLoneBareSite — "one address by default" (fix: the
 * service-sheet gate asking for a site address a second time).
 *
 * When a customer's address is saved and they have EXACTLY ONE site which is
 * BARE, copy the address onto that site so the site-address invariant is
 * satisfied legitimately. Strict guards protect real site addresses:
 *   - never a customer with 2+ sites;
 *   - never a site that already has a usable address;
 *   - never when the customer has no usable address to copy.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Import safety: customers.ts imports the server supabase client at module
// load (only called inside other functions, not this helper).
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

const { getSitesByCustomerMock, updateSiteMock } = vi.hoisted(() => ({
  getSitesByCustomerMock: vi.fn(),
  updateSiteMock: vi.fn(),
}));
vi.mock("@/lib/data/sites", () => ({
  getSitesByCustomer: getSitesByCustomerMock,
  updateSite: updateSiteMock,
}));

import { propagateAddressToLoneBareSite } from "@/lib/data/customers";
import type { Customer, Site } from "@/types/database";

const CUST_ID = "cust-1";

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: CUST_ID,
    address_line_1: "12 High Street",
    address_line_2: null,
    town: "Testford",
    county: "Kent",
    postcode: "TF1 1AA",
    ...over,
  } as unknown as Customer;
}

function site(over: Partial<Site> = {}): Site {
  return {
    id: "site-1",
    customer_id: CUST_ID,
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: "—",
    postcode: null,
    ...over,
  } as unknown as Site;
}

beforeEach(() => {
  getSitesByCustomerMock.mockReset();
  updateSiteMock.mockReset();
  updateSiteMock.mockImplementation(async (id: string, input: Record<string, string>) => ({
    id,
    customer_id: CUST_ID,
    ...input,
  }));
});

describe("propagateAddressToLoneBareSite", () => {
  it("copies the customer address onto a LONE BARE site and returns it", async () => {
    getSitesByCustomerMock.mockResolvedValue([site()]);

    const result = await propagateAddressToLoneBareSite(CUST_ID, customer());

    expect(updateSiteMock).toHaveBeenCalledTimes(1);
    expect(updateSiteMock).toHaveBeenCalledWith("site-1", {
      address_line_1: "12 High Street",
      address_line_2: "",
      town: "Testford",
      county: "Kent",
      postcode: "TF1 1AA",
    });
    expect(result?.id).toBe("site-1");
    expect(result?.address_line_1).toBe("12 High Street");
    expect(result?.town).toBe("Testford");
  });

  it("does NOT touch a customer with 2+ sites (never clobber a real site)", async () => {
    getSitesByCustomerMock.mockResolvedValue([
      site({ id: "site-1" }),
      site({ id: "site-2", address_line_1: "9 Real Road", town: "Elsewhere" }),
    ]);

    const result = await propagateAddressToLoneBareSite(CUST_ID, customer());

    expect(updateSiteMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("does NOT touch a single site that already has a usable address", async () => {
    getSitesByCustomerMock.mockResolvedValue([
      site({ address_line_1: "1 Existing Way", town: "Alreadytown" }),
    ]);

    const result = await propagateAddressToLoneBareSite(CUST_ID, customer());

    expect(updateSiteMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("does NOT propagate when the customer has no usable address", async () => {
    // Missing town → not a usable address (line1 + town both required).
    const result = await propagateAddressToLoneBareSite(
      CUST_ID,
      customer({ town: null })
    );
    expect(getSitesByCustomerMock).not.toHaveBeenCalled();
    expect(updateSiteMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("does NOT propagate when the customer has zero sites", async () => {
    getSitesByCustomerMock.mockResolvedValue([]);
    const result = await propagateAddressToLoneBareSite(CUST_ID, customer());
    expect(updateSiteMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("a null customer county lands as an empty string for updateSite (blank→null there)", async () => {
    getSitesByCustomerMock.mockResolvedValue([site()]);
    await propagateAddressToLoneBareSite(CUST_ID, customer({ county: null }));
    expect(updateSiteMock).toHaveBeenCalledWith(
      "site-1",
      expect.objectContaining({ county: "" })
    );
  });
});
