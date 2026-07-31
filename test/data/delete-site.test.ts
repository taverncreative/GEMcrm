/**
 * Delete-a-site (soft delete, cascading) — data layer + action.
 *
 * A site delete is a soft delete through the `soft_delete_site` SECURITY
 * DEFINER RPC (migration 050), NOT a direct `.update()`: the sites SELECT
 * policy (`USING (deleted_at IS NULL)`, migration 029) is enforced against
 * the post-update row PostgREST returns, so a self-hiding update is
 * rejected with 42501 — the catch-22 documented for customers (032), jobs
 * (038) and agreements (043).
 *
 * Unlike those, this one CASCADES: every jobs read embeds `sites!inner`, so
 * hiding the site already makes its jobs unreachable; leaving them
 * undeleted would only leave zombie `scheduled` rows behind. The RPC
 * therefore stamps, in one transaction, the site's jobs, then its dead
 * (draft/cancelled) agreements, then the site — and REFUSES outright if the
 * site has an active or paused agreement, because that is a live contract.
 *
 * Pinned against in-memory tables. The supabase stub applies the RLS SELECT
 * policy itself (a row with `deleted_at` is invisible to every read) and
 * mirrors the RPC body, including the live-agreement guard raising.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = { sites: [], jobs: [], agreements: [], reports: [] };

// Read builder covering the chains the site reads use:
//   select("*").eq().order()                        → rows
//   select("*").eq().single()                       → row | PGRST116
//   select("id", {count:"exact",head:true}).in().not().is()  → count
// Filters are AND-ed; the RLS SELECT policy is modelled at the top of
// `matched()` for the soft-deletable tables.
function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let wantCount = false;

  const rlsHides = table !== "reports"; // reports has no self-hiding policy
  const matched = () =>
    tables[table]
      .filter((r) => (rlsHides ? r.deleted_at == null : true))
      .filter((r) => filters.every((f) => f(r)));

  const result = () =>
    wantCount
      ? { data: null, count: matched().length, error: null }
      : { data: matched().map((r) => ({ ...r })), count: null, error: null };

  const builder = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count) wantCount = true;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push((r) => (val === null ? r[col] == null : r[col] === val));
      return builder;
    },
    not(col: string, _op: string, val: unknown) {
      filters.push((r) => (val === null ? r[col] != null : r[col] !== val));
      return builder;
    },
    order() {
      return builder;
    },
    async single() {
      const rows = matched();
      if (rows.length === 0) {
        return { data: null, error: { code: "PGRST116", message: "0 rows" } };
      }
      return { data: { ...rows[0] }, error: null };
    },
    then(resolve: (v: ReturnType<typeof result>) => void) {
      return resolve(result());
    },
  };
  return builder;
}

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => makeQuery(table),
    rpc: rpcMock,
  }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import {
  deleteSite,
  getSiteDeleteImpact,
  getSiteById,
  getSitesByCustomer,
} from "@/lib/data/sites";
import { deleteSiteAction } from "@/app/(app)/sites/[id]/actions";

const CUSTOMER = "c0000000-0000-4000-8000-000000000000";
const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE = "22222222-2222-4222-8222-222222222222";
const JOB_A = "aa000000-0000-4000-8000-000000000000";
const JOB_B = "bb000000-0000-4000-8000-000000000000";

/** Mirrors the migration-050 function body, guard included. */
function runSoftDeleteSite(siteId: string) {
  const live = tables.agreements.filter(
    (a) =>
      a.site_id === siteId &&
      a.deleted_at == null &&
      (a.status === "active" || a.status === "paused")
  ).length;
  if (live > 0) {
    return {
      error: {
        code: "P0001",
        message: `soft_delete_site: site has ${live} live agreement(s) — cancel them first`,
      },
    };
  }
  const now = new Date().toISOString();
  for (const j of tables.jobs) {
    if (j.site_id === siteId && j.deleted_at == null) j.deleted_at = now;
  }
  for (const a of tables.agreements) {
    if (a.site_id === siteId && a.deleted_at == null) a.deleted_at = now;
  }
  for (const s of tables.sites) {
    if (s.id === siteId && s.deleted_at == null) s.deleted_at = now;
  }
  return { error: null };
}

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });
  vi.mocked(revalidatePath).mockClear();
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (fn: string, params: { p_id: string }) =>
    fn === "soft_delete_site" ? runSoftDeleteSite(params.p_id) : { error: null }
  );

  tables.sites = [
    { id: SITE, customer_id: CUSTOMER, address_line_1: "5 Mill Lane", created_at: "2026-01-01", deleted_at: null },
    { id: OTHER_SITE, customer_id: CUSTOMER, address_line_1: "9 Kiln Row", created_at: "2026-01-02", deleted_at: null },
  ];
  tables.jobs = [
    { id: JOB_A, site_id: SITE, job_status: "completed", deleted_at: null },
    { id: JOB_B, site_id: SITE, job_status: "scheduled", deleted_at: null },
    { id: "cc0", site_id: OTHER_SITE, job_status: "scheduled", deleted_at: null },
  ];
  tables.agreements = [
    { id: "ag1", site_id: SITE, status: "cancelled", deleted_at: null },
  ];
  tables.reports = [
    { id: "r1", job_id: JOB_A, pdf_url: "https://x/sheet.pdf", deleted_at: null },
  ];
});

describe("getSiteDeleteImpact — names the dependents", () => {
  it("counts jobs, upcoming jobs, service sheets and dead agreements", async () => {
    const impact = await getSiteDeleteImpact(SITE);
    expect(impact.jobs).toBe(2);
    expect(impact.upcomingJobs).toBe(1);
    expect(impact.serviceSheets).toBe(1);
    expect(impact.deadAgreements).toBe(1);
    expect(impact.liveAgreements).toBe(0);
  });

  it("separates live (active/paused) agreements from dead ones", async () => {
    tables.agreements.push({
      id: "ag2",
      site_id: SITE,
      status: "active",
      deleted_at: null,
    });
    tables.agreements.push({
      id: "ag3",
      site_id: SITE,
      status: "paused",
      deleted_at: null,
    });
    const impact = await getSiteDeleteImpact(SITE);
    expect(impact.liveAgreements).toBe(2);
    expect(impact.deadAgreements).toBe(1);
  });

  it("does not count another site's rows", async () => {
    const impact = await getSiteDeleteImpact(OTHER_SITE);
    expect(impact.jobs).toBe(1);
    expect(impact.deadAgreements).toBe(0);
  });
});

describe("deleteSite — soft delete via RPC, cascading", () => {
  it("calls the soft_delete_site RPC (not a direct update)", async () => {
    await deleteSite(SITE);
    expect(rpcMock).toHaveBeenCalledWith("soft_delete_site", { p_id: SITE });
  });

  it("stamps the site, its jobs and its dead agreements", async () => {
    await deleteSite(SITE);
    expect(tables.sites.find((s) => s.id === SITE)!.deleted_at).not.toBeNull();
    expect(tables.jobs.find((j) => j.id === JOB_A)!.deleted_at).not.toBeNull();
    expect(tables.jobs.find((j) => j.id === JOB_B)!.deleted_at).not.toBeNull();
    expect(tables.agreements[0].deleted_at).not.toBeNull();
  });

  it("leaves another site and its jobs alone", async () => {
    await deleteSite(SITE);
    expect(
      tables.sites.find((s) => s.id === OTHER_SITE)!.deleted_at
    ).toBeNull();
    expect(tables.jobs.find((j) => j.id === "cc0")!.deleted_at).toBeNull();
  });

  it("leaves the service sheet in place — it is the record of work", async () => {
    await deleteSite(SITE);
    expect(tables.reports[0].deleted_at).toBeNull();
  });

  it("surfaces an RPC error as a thrown failure", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: "42501", message: "row-level security" },
    });
    await expect(deleteSite(SITE)).rejects.toThrow("Failed to delete site");
  });
});

describe("a deleted site disappears from its lists", () => {
  it("drops out of the customer's site list, and its detail read", async () => {
    expect((await getSitesByCustomer(CUSTOMER)).map((s) => s.id)).toContain(
      SITE
    );
    await deleteSite(SITE);
    const after = (await getSitesByCustomer(CUSTOMER)).map((s) => s.id);
    expect(after).not.toContain(SITE);
    expect(after).toContain(OTHER_SITE);
    expect(await getSiteById(SITE)).toBeNull();
  });
});

describe("deleteSiteAction — auth gate, live-agreement block, happy path", () => {
  it("requires auth — rejects and writes nothing when unauthenticated", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(deleteSiteAction(SITE)).rejects.toThrow("Unauthorized");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(tables.sites.find((s) => s.id === SITE)!.deleted_at).toBeNull();
  });

  it("BLOCKS a site carrying an active agreement, and writes nothing", async () => {
    tables.agreements.push({
      id: "ag2",
      site_id: SITE,
      status: "active",
      deleted_at: null,
    });
    const res = await deleteSiteAction(SITE);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/live agreement/i);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(tables.sites.find((s) => s.id === SITE)!.deleted_at).toBeNull();
    expect(tables.jobs.find((j) => j.id === JOB_B)!.deleted_at).toBeNull();
  });

  it("BLOCKS a site carrying a paused agreement", async () => {
    tables.agreements.push({
      id: "ag2",
      site_id: SITE,
      status: "paused",
      deleted_at: null,
    });
    expect((await deleteSiteAction(SITE)).success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("soft-deletes and returns success when only dead agreements remain", async () => {
    const res = await deleteSiteAction(SITE);
    expect(res).toEqual({ success: true });
    expect(tables.sites.find((s) => s.id === SITE)!.deleted_at).not.toBeNull();
  });

  it("returns an error for a missing id, without touching the tables", async () => {
    const res = await deleteSiteAction("");
    expect(res.success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // Perf: the confirm dialog mirrors the delete into Dexie and runs a
  // scoped router.refresh(), so the action must not purge the router cache.
  it("does NOT call revalidatePath", async () => {
    await deleteSiteAction(SITE);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
