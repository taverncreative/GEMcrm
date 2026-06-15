/**
 * Offline → reconnect end-to-end for a SPARSE booking (Pass 1b).
 *
 * Drives the REAL local-first path, not the pieces:
 *   1. makeBookingMeta.parseInput + applyLocal  → optimistic Dexie write
 *      (new customer, bare site, scheduled job) — exactly what the modal
 *      does on submit.
 *   2. enqueueAction                            → a real outbox entry
 *      (what useLocalFirstAction enqueues).
 *   3. drainOutbox (the engine's push half)     → real registry dispatch →
 *      the REAL createQuickBookingAction → the REAL data layer.
 *
 * Only the system BOUNDARIES are doubled: the Supabase transport (an
 * in-memory store standing in for the DB), auth (requireUser), and
 * next/cache (revalidatePath). The outbox, the sync engine's drain, the
 * registry, the server action, and the data layer are all the real thing.
 *
 * Asserts the booking lands server-side with a bare site (null address,
 * "—" county) and a scheduled job with null call_type, using the SAME ids
 * the optimistic write used (no remap, no duplicate).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── In-memory Supabase store (the DB boundary) ───────────────────────────
const store = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Result = { data: unknown; error: unknown };
  interface SB {
    eq(col: string, val: unknown): SB;
    not(col: string): SB;
    order(): SB;
    limit(): SB;
    in(col: string, vals: unknown[]): SB;
    maybeSingle(): Promise<Result>;
    single(): Promise<Result>;
    then(resolve: (v: Result) => void): void;
  }

  const tables: Record<string, Row[]> = {
    customers: [],
    sites: [],
    jobs: [],
    invoice_jobs: [],
  };

  function selectBuilder(table: string, sel: string): SB {
    let rows = [...tables[table]];
    const api: SB = {
      eq(col, val) {
        rows = rows.filter((r) => r[col] === val);
        return api;
      },
      not(col) {
        rows = rows.filter((r) => r[col] != null);
        return api;
      },
      order: () => api,
      limit: () => api,
      in(col, vals) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return api;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => {
        const row = rows[0] ?? null;
        // createBooking reads the site with its customer embedded to
        // compute the job reference.
        if (row && table === "sites" && sel.includes("customers")) {
          const cust =
            tables.customers.find((c) => c.id === row.customer_id) ?? null;
          return {
            data: {
              ...row,
              customer: cust
                ? {
                    customer_type: cust.customer_type,
                    company_name: cust.company_name,
                    name: cust.name,
                  }
                : null,
            },
            error: null,
          };
        }
        return {
          data: row,
          error: row ? null : { code: "PGRST116", message: "no rows" },
        };
      },
      // generateJobReference awaits the chain directly (no .single()).
      then(resolve) {
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }

  function from(table: string) {
    const applyOne = (row: Row) => {
      const arr = tables[table];
      const i = arr.findIndex((r) => r.id === row.id);
      if (i >= 0) arr[i] = { ...arr[i], ...row };
      else arr.push({ ...row });
    };
    return {
      upsert(rowOrRows: Row | Row[]) {
        if (Array.isArray(rowOrRows)) rowOrRows.forEach(applyOne);
        else applyOne(rowOrRows);
        const first = Array.isArray(rowOrRows) ? rowOrRows[0] : rowOrRows;
        const single = async () => ({ data: { ...first }, error: null });
        return {
          select: () => ({ single, maybeSingle: single }),
          then: (resolve: (v: Result) => void) =>
            resolve({ data: null, error: null }),
        };
      },
      insert(row: Row) {
        applyOne(row);
        return {
          select: () => ({ single: async () => ({ data: { ...row }, error: null }) }),
          then: (resolve: (v: Result) => void) =>
            resolve({ data: null, error: null }),
        };
      },
      select: (sel?: string) => selectBuilder(table, sel ?? ""),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
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

import { makeBookingMeta } from "@/components/bookings/booking-modal";
import { enqueueAction } from "@/lib/db/outbox";
import { drainOutbox } from "@/lib/sync/push";
import { db } from "@/lib/db";

function sparseSubmitFd(): FormData {
  // What the modal submits for a quick add: a customer name + a date.
  // No call type, no site address.
  const f = new FormData();
  const vals: Record<string, string> = {
    mode_customer: "new",
    mode_site: "new",
    customer_name: "Sparse Offline",
    customer_company: "",
    customer_email: "",
    customer_phone: "",
    customer_type: "commercial",
    customer_id: "",
    site_id: "",
    site_line1: "",
    site_line2: "",
    site_town: "",
    site_county: "",
    site_postcode: "",
    job_date: "2026-08-01",
    job_time: "",
    job_time_end: "",
    call_type: "",
    value: "",
    report_notes: "",
    pest_species: "[]",
  };
  for (const [k, v] of Object.entries(vals)) f.append(k, v);
  return f;
}

beforeEach(async () => {
  store.tables.customers.length = 0;
  store.tables.sites.length = 0;
  store.tables.jobs.length = 0;
  store.tables.invoice_jobs.length = 0;
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
  await db.outbox.clear();
  vi.clearAllMocks();
});

describe("sparse booking: offline optimistic write → drain → server", () => {
  it("writes locally + enqueues, then the real engine drain lands it server-side", async () => {
    const meta = makeBookingMeta(); // create mode
    const fd = sparseSubmitFd();

    // 1. Optimistic write (modal submit, offline).
    const input = meta.parseInput!(fd);
    expect(input).not.toBeNull(); // sparse must take the optimistic path
    await meta.applyLocal(input!);

    // Local Dexie rows exist before any server contact.
    const localJob = await db.jobs.get(input!.jobId);
    expect(localJob!.job_status).toBe("scheduled");
    expect(localJob!.call_type).toBeNull();
    const localSite = await db.sites.get(input!.newSiteId!);
    expect(localSite!.address_line_1).toBeNull();
    expect(localSite!.county).toBe("—");

    // 2. Enqueue the outbox entry (what useLocalFirstAction does).
    await enqueueAction({
      action_name: "createQuickBookingAction",
      args: meta.replayArgs!(input!, fd),
      entity_type: "job",
      entity_id: input!.jobId,
      op: "create",
      entity_ids: meta.entityIds!(input!),
    });
    expect(await db.outbox.count()).toBe(1);
    // Nothing has reached the "server" yet (we were offline).
    expect(store.tables.jobs).toHaveLength(0);

    // 3. Reconnect: run the REAL engine drain.
    const result = await drainOutbox();
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // Outbox cleared on success (no stuck/retry).
    expect(await db.outbox.count()).toBe(0);

    // Server landed exactly one of each, with the SAME ids (no remap).
    expect(store.tables.customers).toHaveLength(1);
    expect(store.tables.customers[0].id).toBe(input!.newCustomerId);
    expect(store.tables.customers[0].name).toBe("Sparse Offline");

    expect(store.tables.sites).toHaveLength(1); // no duplicate site
    expect(store.tables.sites[0].id).toBe(input!.newSiteId);
    expect(store.tables.sites[0].address_line_1).toBeNull();
    expect(store.tables.sites[0].county).toBe("—");

    expect(store.tables.jobs).toHaveLength(1); // no duplicate job
    expect(store.tables.jobs[0].id).toBe(input!.jobId);
    expect(store.tables.jobs[0].site_id).toBe(input!.newSiteId);
    expect(store.tables.jobs[0].job_status).toBe("scheduled");
    expect(store.tables.jobs[0].call_type).toBeNull();
  });
});
