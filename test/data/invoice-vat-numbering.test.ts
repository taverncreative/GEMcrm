/**
 * Invoice creation (migration 037 + VAT flag): both creation paths must
 *   1. insert NO invoice_number (the assign_invoice_number DB trigger
 *      assigns it — the app never does), and
 *   2. derive VAT from BUSINESS.vatRegistered:
 *        not registered → no VAT (amount is the total, no breakdown);
 *        registered     → 20% standard-rated gross split.
 *
 * Both flag states are exercised so the dormant registered path stays
 * covered. Verified against an in-memory PostgREST stub that captures the
 * insert payload. createStandaloneInvoice runs its no-job path so the
 * assertion isolates VAT/number handling from job derivation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const business = vi.hoisted(() => ({ vatRegistered: false }));
vi.mock("@/lib/constants/branding", () => ({
  BUSINESS: {
    get vatRegistered() {
      return business.vatRegistered;
    },
    vatNumber: "",
    name: "GEM Services",
    signoffName: "Nate Green",
  },
}));

let captured: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "invoices") {
        return {
          insert: (payload: Record<string, unknown>) => {
            captured = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "inv1", ...payload },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      if (table === "invoice_jobs") {
        return { insert: async () => ({ error: null }) };
      }
      // jobs
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    },
  }),
}));

import {
  createInvoiceForJob,
  createStandaloneInvoice,
} from "@/lib/data/invoices";

beforeEach(() => {
  captured = null;
  business.vatRegistered = false;
  vi.clearAllMocks();
});

describe("createInvoiceForJob — auto path", () => {
  it("NOT registered → no VAT, amount is the total, no number", async () => {
    await createInvoiceForJob("job1", "cust1", 105);
    expect(captured).toMatchObject({
      job_id: "job1",
      customer_id: "cust1",
      amount: 105,
      subtotal_amount: null,
      vat_amount: null,
      vat_rate: 0,
      status: "draft",
    });
    expect(captured).toHaveProperty("due_date");
    expect(captured).not.toHaveProperty("invoice_number");
  });

  it("registered → 20% gross split (dormant path), still no number", async () => {
    business.vatRegistered = true;
    await createInvoiceForJob("job1", "cust1", 105);
    expect(captured).toMatchObject({
      amount: 105,
      subtotal_amount: 87.5,
      vat_amount: 17.5,
      vat_rate: 20,
    });
    expect(captured).not.toHaveProperty("invoice_number");
  });
});

describe("createStandaloneInvoice — manual path", () => {
  const input = {
    customer_id: "cust1",
    job_ids: [] as string[],
    // Bogus advisory VAT — must be ignored either way.
    subtotal: 999,
    vat_amount: 999,
    vat_rate: 0,
    total: 120,
    status: "draft" as const,
  };

  it("NOT registered → no VAT, amount is the total, no number", async () => {
    await createStandaloneInvoice(input);
    expect(captured).toMatchObject({
      customer_id: "cust1",
      amount: 120,
      subtotal_amount: null,
      vat_amount: null,
      vat_rate: 0,
    });
    expect(captured).not.toHaveProperty("invoice_number");
  });

  it("registered → 20% gross split (dormant path), still no number", async () => {
    business.vatRegistered = true;
    await createStandaloneInvoice(input);
    expect(captured).toMatchObject({
      amount: 120,
      subtotal_amount: 100,
      vat_amount: 20,
      vat_rate: 20,
    });
    expect(captured).not.toHaveProperty("invoice_number");
  });
});
