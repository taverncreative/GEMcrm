/**
 * Document-completeness readiness rule (Pass 2A).
 *
 * Pins the single source of truth that decides, for a (customer, action)
 * pair, whether the completeness prompt is needed and which fields it asks
 * for:
 *   - SEND      → email required when absent; address offered (optional).
 *   - GENERATE  → nothing required (name is always present on a booking).
 *   - DOWNLOAD  → same as generate.
 *   - ADDRESS   → never required, only offered alongside a needed prompt.
 */
import { describe, it, expect } from "vitest";
import {
  customerDocReadiness,
  needsDocReadyPrompt,
  type DocAction,
} from "@/lib/documents/doc-readiness";
import type { Customer } from "@/types/database";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "c-1",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    deleted_at: null,
    name: "Acme Pest Co",
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

describe("customerDocReadiness — SEND", () => {
  it("email on file → ready, nothing required or offered", () => {
    const r = customerDocReadiness(
      makeCustomer({ email: "ops@acme.co.uk" }),
      "send"
    );
    expect(r.ready).toBe(true);
    expect(r.required).toEqual([]);
    expect(r.optional).toEqual([]);
  });

  it("no email → not ready, email required, address offered", () => {
    const r = customerDocReadiness(makeCustomer({ email: null }), "send");
    expect(r.ready).toBe(false);
    expect(r.required).toEqual(["email"]);
    expect(r.optional).toEqual(["address"]); // no address on file → offered
  });

  it("no email but address already on file → email required, address NOT offered", () => {
    const r = customerDocReadiness(
      makeCustomer({ email: null, address_line_1: "1 Way", postcode: "T1 1AA" }),
      "send"
    );
    expect(r.ready).toBe(false);
    expect(r.required).toEqual(["email"]);
    expect(r.optional).toEqual([]); // address present → nothing to offer
  });

  it("whitespace-only email counts as missing", () => {
    const r = customerDocReadiness(makeCustomer({ email: "   " }), "send");
    expect(r.ready).toBe(false);
    expect(r.required).toEqual(["email"]);
  });

  it("email present but no address → ready (address is never required)", () => {
    const r = customerDocReadiness(
      makeCustomer({ email: "ops@acme.co.uk", address_line_1: null }),
      "send"
    );
    expect(r.ready).toBe(true);
    expect(r.optional).toEqual([]);
  });

  it("a town alone counts as an address on file", () => {
    const r = customerDocReadiness(
      makeCustomer({ email: null, town: "Folkestone" }),
      "send"
    );
    expect(r.optional).toEqual([]);
  });
});

describe("customerDocReadiness — GENERATE / DOWNLOAD never prompt", () => {
  it.each<DocAction>(["generate", "download"])(
    "%s with a bare customer (no email, no address) → ready, nothing required",
    (action) => {
      const r = customerDocReadiness(makeCustomer({ email: null }), action);
      expect(r.ready).toBe(true);
      expect(r.required).toEqual([]);
      expect(r.optional).toEqual([]);
    }
  );

  it("generate with a fully-populated customer → ready", () => {
    const r = customerDocReadiness(
      makeCustomer({ email: "ops@acme.co.uk", address_line_1: "1 Way" }),
      "generate"
    );
    expect(r.ready).toBe(true);
  });
});

describe("customerDocReadiness — null customer", () => {
  it("send + null customer → email required, address offered", () => {
    const r = customerDocReadiness(null, "send");
    expect(r.ready).toBe(false);
    expect(r.required).toEqual(["email"]);
    expect(r.optional).toEqual(["address"]);
  });

  it("generate + null customer → ready (handled by the caller's own guard)", () => {
    const r = customerDocReadiness(null, "generate");
    expect(r.ready).toBe(true);
    expect(r.required).toEqual([]);
  });
});

describe("needsDocReadyPrompt convenience", () => {
  it("true only when a required field is missing", () => {
    expect(needsDocReadyPrompt(makeCustomer({ email: null }), "send")).toBe(true);
    expect(
      needsDocReadyPrompt(makeCustomer({ email: "ops@acme.co.uk" }), "send")
    ).toBe(false);
    expect(needsDocReadyPrompt(makeCustomer({ email: null }), "generate")).toBe(
      false
    );
    expect(needsDocReadyPrompt(makeCustomer({ email: null }), "download")).toBe(
      false
    );
  });
});
