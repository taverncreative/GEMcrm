/**
 * Document-completeness readiness rule (Pass 2).
 *
 * The single source of truth that decides, for a (customer, target) pair,
 * whether the completeness prompt is needed and which fields it asks for:
 *   - SEND      → email required when absent.
 *   - GENERATE / DOWNLOAD → nothing required (name is always present).
 *   - ADDRESS   → never required; offered only for an INVOICE send whose
 *                 customer has no address on file. Reports/agreements never
 *                 collect a customer address (they show the site address).
 */
import { describe, it, expect } from "vitest";
import {
  customerDocReadiness,
  needsDocReadyPrompt,
  type DocType,
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

describe("customerDocReadiness — SEND, email gate (doc-independent)", () => {
  it.each<DocType>(["invoice", "report", "agreement"])(
    "%s send with email on file → ready",
    (doc) => {
      const r = customerDocReadiness(
        makeCustomer({ email: "ops@acme.co.uk" }),
        { verb: "send", doc }
      );
      expect(r.ready).toBe(true);
      expect(r.required).toEqual([]);
      expect(r.optional).toEqual([]);
    }
  );

  it.each<DocType>(["invoice", "report", "agreement"])(
    "%s send with no email → email required",
    (doc) => {
      const r = customerDocReadiness(makeCustomer({ email: null }), {
        verb: "send",
        doc,
      });
      expect(r.ready).toBe(false);
      expect(r.required).toEqual(["email"]);
    }
  );

  it("whitespace-only email counts as missing", () => {
    const r = customerDocReadiness(makeCustomer({ email: "  " }), {
      verb: "send",
      doc: "invoice",
    });
    expect(r.required).toEqual(["email"]);
  });
});

describe("customerDocReadiness — address offered for INVOICE only", () => {
  it("invoice send, no email, no address → offers address", () => {
    const r = customerDocReadiness(makeCustomer({ email: null }), {
      verb: "send",
      doc: "invoice",
    });
    expect(r.optional).toEqual(["address"]);
  });

  it("invoice send, no email, address already on file → does NOT offer it", () => {
    const r = customerDocReadiness(
      makeCustomer({ email: null, address_line_1: "1 Way", postcode: "T1 1AA" }),
      { verb: "send", doc: "invoice" }
    );
    expect(r.optional).toEqual([]);
  });

  it("report send, no email → never offers an address (site address is used)", () => {
    const r = customerDocReadiness(makeCustomer({ email: null }), {
      verb: "send",
      doc: "report",
    });
    expect(r.optional).toEqual([]);
  });

  it("agreement send, no email → never offers an address", () => {
    const r = customerDocReadiness(makeCustomer({ email: null }), {
      verb: "send",
      doc: "agreement",
    });
    expect(r.optional).toEqual([]);
  });

  it("invoice send with email present → no prompt, so no address offered", () => {
    const r = customerDocReadiness(makeCustomer({ email: "ops@acme.co.uk" }), {
      verb: "send",
      doc: "invoice",
    });
    expect(r.ready).toBe(true);
    expect(r.optional).toEqual([]);
  });
});

describe("customerDocReadiness — GENERATE / DOWNLOAD never prompt", () => {
  it.each<DocType>(["invoice", "report", "agreement"])(
    "generate %s with a bare customer → ready, nothing required/offered",
    (doc) => {
      const r = customerDocReadiness(makeCustomer({ email: null }), {
        verb: "generate",
        doc,
      });
      expect(r.ready).toBe(true);
      expect(r.required).toEqual([]);
      expect(r.optional).toEqual([]);
    }
  );

  it("download invoice with no email → ready (download === generate)", () => {
    const r = customerDocReadiness(makeCustomer({ email: null }), {
      verb: "download",
      doc: "invoice",
    });
    expect(r.ready).toBe(true);
  });
});

describe("customerDocReadiness — null customer", () => {
  it("invoice send + null → email required, address offered", () => {
    const r = customerDocReadiness(null, { verb: "send", doc: "invoice" });
    expect(r.required).toEqual(["email"]);
    expect(r.optional).toEqual(["address"]);
  });

  it("report send + null → email required, no address", () => {
    const r = customerDocReadiness(null, { verb: "send", doc: "report" });
    expect(r.required).toEqual(["email"]);
    expect(r.optional).toEqual([]);
  });

  it("generate + null → ready", () => {
    const r = customerDocReadiness(null, { verb: "generate", doc: "invoice" });
    expect(r.ready).toBe(true);
  });
});

describe("needsDocReadyPrompt convenience", () => {
  it("true only when a required field is missing", () => {
    expect(
      needsDocReadyPrompt(makeCustomer({ email: null }), {
        verb: "send",
        doc: "invoice",
      })
    ).toBe(true);
    expect(
      needsDocReadyPrompt(makeCustomer({ email: "ops@acme.co.uk" }), {
        verb: "send",
        doc: "report",
      })
    ).toBe(false);
    expect(
      needsDocReadyPrompt(makeCustomer({ email: null }), {
        verb: "generate",
        doc: "invoice",
      })
    ).toBe(false);
  });
});
