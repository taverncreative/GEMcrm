/**
 * Offline → reconnect end-to-end for a document-completeness email capture.
 *
 * Mirrors the relaxed-booking offline-sync test: it drives the REAL path,
 * not the pieces —
 *   1. captureDocDetails(customer, {email}, online=false) → optimistic Dexie
 *      write + a real outbox entry (exactly what the gate does offline when
 *      an operator completes a service sheet in the field).
 *   2. drainOutbox (the engine's push half) → real registry dispatch → the
 *      REAL setCustomerDocDetailsAction → the REAL data layer.
 *
 * Only the system BOUNDARIES are doubled: the Supabase transport (an
 * in-memory customers table standing in for the DB), auth (requireUser),
 * and next/cache (revalidatePath).
 *
 * Asserts the email lands locally immediately, stays off the server until
 * reconnect, and after drain the customer SERVER-SIDE carries the email,
 * with no duplicate row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── In-memory Supabase store (the DB boundary) ───────────────────────────
const store = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = { customers: [] };
  function from(table: string) {
    return {
      // updateCustomerDocDetails does `.update(patch).eq("id", id)`.
      update(patch: Row) {
        return {
          eq: async (col: string, val: unknown) => {
            const row = (tables[table] ?? []).find((r) => r[col] === val);
            if (row) Object.assign(row, patch);
            return { error: null };
          },
        };
      },
    };
  }
  return { tables, client: { from } };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => store.client,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "test-user" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { captureDocDetails } from "@/lib/documents/capture-doc-details";
import { drainOutbox } from "@/lib/sync/push";
import { db } from "@/lib/db";
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

beforeEach(async () => {
  store.tables.customers.length = 0;
  store.tables.customers.push({ id: "c-1", name: "Acme Pest Co", email: null });
  await db.customers.clear();
  await db.customers.put(makeCustomer({ id: "c-1", email: null }));
  await db.outbox.clear();
  vi.clearAllMocks();
});

describe("offline doc-detail capture: optimistic write → drain → server", () => {
  it("captures locally + enqueues offline, then the real drain lands it server-side", async () => {
    const customer = makeCustomer({ id: "c-1", email: null });

    // 1. Offline capture (what the gate does in the field, online=false).
    //    Mixed-case input proves the server-side lower/trim normalisation.
    const res = await captureDocDetails(
      customer,
      { email: "Field@Acme.co.uk" },
      false
    );
    expect(res.success).toBe(true);
    expect(res.deferred).toBe(true); // captured, but a send must wait for sync

    // Local Dexie row carries the email immediately (optimistic).
    expect((await db.customers.get("c-1"))!.email).toBe("field@acme.co.uk");

    // Exactly one queued entry; nothing has reached the "server" yet.
    expect(await db.outbox.count()).toBe(1);
    expect(store.tables.customers[0].email).toBeNull();

    // 2. Reconnect: run the REAL engine drain.
    const result = await drainOutbox();
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // Outbox cleared on success (no stuck/retry).
    expect(await db.outbox.count()).toBe(0);

    // Server now carries the email (lower/trimmed), and there's still exactly
    // one customer row — the email merged in, no duplicate.
    expect(store.tables.customers).toHaveLength(1);
    expect(store.tables.customers[0].id).toBe("c-1");
    expect(store.tables.customers[0].email).toBe("field@acme.co.uk");
  });
});
