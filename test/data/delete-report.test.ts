/**
 * Service-sheet soft delete + the orphan-safe Documents read (migration 049).
 *
 * Two related behaviours, both new:
 *
 *  1. A report whose job has been SOFT-DELETED must still render in the
 *     Documents list WITH its reference, customer, site and date, plus a
 *     `jobDeleted` marker. The sheet is the record of work performed, so
 *     losing the job must not anonymise it — and must not hide it either.
 *     Before 049 the list used a PostgREST embed (`job:jobs(...)`), which is
 *     a LEFT join subject to the jobs SELECT policy (`deleted_at IS NULL`,
 *     migration 029): the embed came back NULL and the row collapsed to a
 *     bare "Service Sheet" with no detail at all. The fix is the
 *     `list_report_documents` SECURITY DEFINER RPC, which resolves
 *     job/site/customer owner-side and reports `job_deleted`.
 *
 *  2. `softDeleteReport` stamps `deleted_at` through the `soft_delete_report`
 *     SECURITY DEFINER RPC (never a hard delete — 039 revoked hard DELETE on
 *     the core five precisely so no cascade could wipe reports, and 049
 *     extends that revoke to `reports`), which drops the row from the list.
 *     The stored PDF is deliberately left in the bucket.
 *
 * The supabase stub routes `rpc("list_report_documents")` through the same
 * in-memory tables, mirroring the function body: left joins that do NOT
 * filter the job's `deleted_at`, and `job_deleted = (job missing OR job
 * soft-deleted)`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

let reportRows: Row[] = [];
let jobRows: Row[] = [];
let siteRows: Row[] = [];
let customerRows: Row[] = [];

const LIVE_JOB = "11111111-1111-4111-8111-111111111111";
const GONE_JOB = "22222222-2222-4222-8222-222222222222";
const LIVE_REPORT = "aaaaaaaa-1111-4111-8111-111111111111";
const ORPHAN_REPORT = "bbbbbbbb-2222-4222-8222-222222222222";
const CUSTOMER = "cccccccc-3333-4333-8333-333333333333";
const SITE = "dddddddd-4444-4444-8444-444444444444";

/**
 * Read builder covering the chains getAllDocuments / getJobDeleteImpact use:
 * select / eq / is / not / neq / order / limit, awaited directly or via
 * maybeSingle. Filters are AND-ed. Head-count selects return `count`.
 */
function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let countMode = false;

  const source = (): Row[] => {
    if (table === "reports") return reportRows;
    if (table === "jobs") return jobRows;
    return [];
  };
  const matched = () => source().filter((r) => filters.every((f) => f(r)));

  const builder = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count) countMode = true;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
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
    neq(col: string, val: unknown) {
      filters.push((r) => r[col] !== val);
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    async maybeSingle() {
      const rows = matched();
      return { data: rows.length ? { ...rows[0] } : null, error: null };
    },
    // Thenable so `await supabase.from(...).select(...).limit(...)` resolves.
    then(resolve: (v: { data: Row[]; count: number; error: null }) => unknown) {
      const rows = matched();
      return Promise.resolve(
        resolve({
          data: countMode ? [] : rows.map((r) => ({ ...r })),
          count: rows.length,
          error: null,
        })
      );
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

import { softDeleteReport } from "@/lib/data/reports";
import { getAllDocuments, getDocumentForEmail } from "@/lib/data/documents";
import { getJobDeleteImpact } from "@/lib/data/jobs";
import { deleteReportAction } from "@/app/(app)/reports/actions";

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });

  customerRows = [
    { id: CUSTOMER, name: "Patrick Kelleher", company_name: null },
  ];
  siteRows = [
    {
      id: SITE,
      customer_id: CUSTOMER,
      address_line_1: "12 Mill Lane",
      town: "Challock",
      postcode: "TN25 4AB",
    },
  ];
  jobRows = [
    {
      id: LIVE_JOB,
      site_id: SITE,
      reference_number: "00092",
      job_date: "2026-07-20",
      pest_species: ["Rats"],
      job_status: "completed",
      client_signature_url: "sig/live.png",
      deleted_at: null,
    },
    {
      id: GONE_JOB,
      site_id: SITE,
      reference_number: "00091",
      job_date: "2026-07-13",
      pest_species: ["Fleas"],
      job_status: "completed",
      client_signature_url: "sig/gone.png",
      // The real prod orphan: job soft-deleted, report left behind.
      deleted_at: "2026-07-14T18:31:10.984Z",
    },
  ];
  reportRows = [
    {
      id: LIVE_REPORT,
      job_id: LIVE_JOB,
      pdf_url: "https://example.test/live.pdf",
      created_at: "2026-07-20T10:00:00.000Z",
      deleted_at: null,
    },
    {
      id: ORPHAN_REPORT,
      job_id: GONE_JOB,
      pdf_url: "https://example.test/orphan.pdf",
      created_at: "2026-07-13T10:00:00.000Z",
      deleted_at: null,
    },
  ];

  rpcMock.mockReset();
  rpcMock.mockImplementation(async (fn: string, params: { p_id?: string }) => {
    if (fn === "soft_delete_report") {
      for (const r of reportRows) {
        if (r.id === params.p_id && r.deleted_at == null) {
          r.deleted_at = new Date().toISOString();
        }
      }
      return { error: null };
    }
    if (fn === "get_report_document") {
      // Mirrors the single-row definer read: same blind-spot-free join, and
      // the `deleted_at is null` guard lives in the function, not the caller.
      const r = reportRows.find(
        (x) => x.id === params.p_id && x.deleted_at == null
      );
      if (!r) return { data: [], error: null };
      const j = jobRows.find((x) => x.id === r.job_id);
      return {
        data: [
          {
            id: r.id,
            pdf_url: r.pdf_url,
            job_deleted: !j || j.deleted_at != null,
            reference_number: j?.reference_number ?? null,
            job_date: j?.job_date ?? null,
          },
        ],
        error: null,
      };
    }
    if (fn === "list_report_documents") {
      // Mirrors the migration-049 function body. Crucially the jobs join does
      // NOT filter deleted_at — that is the whole point of the definer read.
      const data = reportRows
        .filter((r) => r.deleted_at == null && r.pdf_url != null)
        .map((r) => {
          const j = jobRows.find((x) => x.id === r.job_id);
          const s = siteRows.find((x) => x.id === j?.site_id);
          const c = customerRows.find((x) => x.id === s?.customer_id);
          return {
            id: r.id,
            created_at: r.created_at,
            pdf_url: r.pdf_url,
            job_id: r.job_id,
            job_deleted: !j || j.deleted_at != null,
            reference_number: j?.reference_number ?? null,
            job_date: j?.job_date ?? null,
            pest_species: j?.pest_species ?? null,
            site_address_line_1: s?.address_line_1 ?? null,
            site_town: s?.town ?? null,
            site_postcode: s?.postcode ?? null,
            customer_id: c?.id ?? null,
            customer_name: c?.name ?? null,
            customer_company_name: c?.company_name ?? null,
          };
        })
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at))
        );
      return { data, error: null };
    }
    return { data: [], error: null };
  });
});

function sheet(items: Awaited<ReturnType<typeof getAllDocuments>>, id: string) {
  return items.find((i) => i.docId === id);
}

describe("orphaned service sheet — kept VISIBLE with its details", () => {
  it("a report whose job is soft-deleted still appears in Documents", async () => {
    const items = await getAllDocuments();
    expect(sheet(items, ORPHAN_REPORT)).toBeDefined();
  });

  it("keeps its reference, customer, site and date — not a bare 'Service Sheet'", async () => {
    const orphan = sheet(await getAllDocuments(), ORPHAN_REPORT)!;
    expect(orphan.reference).toBe("00091");
    expect(orphan.title).toBe("Service Sheet 00091");
    expect(orphan.customer?.name).toBe("Patrick Kelleher");
    expect(orphan.siteAddress).toBe("12 Mill Lane, Challock, TN25 4AB");
    // The job date drives the subtitle — present despite the deleted job.
    expect(orphan.subtitle).toBe("13 Jul 2026");
    expect(orphan.pests).toEqual(["Fleas"]);
  });

  it("carries the jobDeleted marker so the row reads as orphaned", async () => {
    const orphan = sheet(await getAllDocuments(), ORPHAN_REPORT)!;
    expect(orphan.jobDeleted).toBe(true);
  });

  it("a report with a LIVE job renders exactly as before, unmarked", async () => {
    const live = sheet(await getAllDocuments(), LIVE_REPORT)!;
    expect(live.reference).toBe("00092");
    expect(live.customer?.name).toBe("Patrick Kelleher");
    expect(live.subtitle).toBe("20 Jul 2026");
    expect(live.jobDeleted).toBe(false);
  });
});

describe("softDeleteReport — soft delete via RPC", () => {
  it("calls the soft_delete_report RPC, never a hard delete", async () => {
    await softDeleteReport(ORPHAN_REPORT);
    expect(rpcMock).toHaveBeenCalledWith("soft_delete_report", {
      p_id: ORPHAN_REPORT,
    });
  });

  it("stamps deleted_at and leaves the pdf_url (the stored PDF) intact", async () => {
    await softDeleteReport(ORPHAN_REPORT);
    const row = reportRows.find((r) => r.id === ORPHAN_REPORT)!;
    expect(row.deleted_at).not.toBeNull();
    expect(row.pdf_url).toBe("https://example.test/orphan.pdf");
  });

  it("removes it from the Documents list", async () => {
    expect(sheet(await getAllDocuments(), ORPHAN_REPORT)).toBeDefined();
    await softDeleteReport(ORPHAN_REPORT);
    expect(sheet(await getAllDocuments(), ORPHAN_REPORT)).toBeUndefined();
  });

  it("touches only the targeted row — other documents are unaffected", async () => {
    await softDeleteReport(ORPHAN_REPORT);
    const items = await getAllDocuments();
    expect(sheet(items, LIVE_REPORT)).toBeDefined();
    expect(reportRows.find((r) => r.id === LIVE_REPORT)!.deleted_at).toBeNull();
  });

  it("surfaces an RPC error as a thrown failure", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: "42501", message: "permission denied" },
    });
    await expect(softDeleteReport(LIVE_REPORT)).rejects.toThrow(
      "Failed to delete service sheet"
    );
  });
});

describe("deleteReportAction — auth gate", () => {
  it("rejects an unauthenticated call and writes nothing", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(deleteReportAction(ORPHAN_REPORT)).rejects.toThrow(
      "Unauthorized"
    );
    expect(reportRows.find((r) => r.id === ORPHAN_REPORT)!.deleted_at).toBeNull();
  });

  it("soft-deletes on the happy path", async () => {
    expect(await deleteReportAction(ORPHAN_REPORT)).toEqual({ success: true });
    expect(
      reportRows.find((r) => r.id === ORPHAN_REPORT)!.deleted_at
    ).not.toBeNull();
  });

  it("returns a failure shape when the RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: "42501", message: "permission denied" },
    });
    const res = await deleteReportAction(ORPHAN_REPORT);
    expect(res.success).toBe(false);
  });
});

describe("emailed attachment agrees with the Documents row", () => {
  it("an ORPHANED sheet emails with its proper label, not the bare fallback", async () => {
    const doc = await getDocumentForEmail("service_sheet", ORPHAN_REPORT);
    expect(doc?.label).toBe("Service Sheet 00091");
    expect(doc?.label).not.toBe("Service Sheet");
    expect(doc?.fileName).toContain("00091");
  });

  it("the label matches the row title exactly, orphan or not", async () => {
    const items = await getAllDocuments();
    for (const id of [ORPHAN_REPORT, LIVE_REPORT]) {
      const doc = await getDocumentForEmail("service_sheet", id);
      expect(doc?.label).toBe(sheet(items, id)!.title);
    }
  });

  it("a live sheet is unaffected", async () => {
    const doc = await getDocumentForEmail("service_sheet", LIVE_REPORT);
    expect(doc?.label).toBe("Service Sheet 00092");
    expect(doc?.pdfUrl).toBe("https://example.test/live.pdf");
  });

  it("a soft-deleted sheet is not emailable", async () => {
    await softDeleteReport(ORPHAN_REPORT);
    expect(await getDocumentForEmail("service_sheet", ORPHAN_REPORT)).toBeNull();
  });
});

describe("job delete impact — completed job with a signed service sheet", () => {
  it("flags a completed job that has a live service sheet", async () => {
    const impact = await getJobDeleteImpact(LIVE_JOB);
    expect(impact.completedWithServiceSheet).toBe(true);
    expect(impact.clientSigned).toBe(true);
  });

  it("does not flag a job whose sheet has already been deleted", async () => {
    await softDeleteReport(LIVE_REPORT);
    const impact = await getJobDeleteImpact(LIVE_JOB);
    expect(impact.completedWithServiceSheet).toBe(false);
  });

  it("does not flag a job that is not completed", async () => {
    jobRows.find((j) => j.id === LIVE_JOB)!.job_status = "scheduled";
    const impact = await getJobDeleteImpact(LIVE_JOB);
    expect(impact.completedWithServiceSheet).toBe(false);
  });

  it("the sheet SURVIVES the job delete and stays visible with its detail", async () => {
    // Soft-deleting the job never cascades: the report row is untouched and
    // the definer read keeps every field resolvable.
    jobRows.find((j) => j.id === LIVE_JOB)!.deleted_at =
      "2026-07-31T00:00:00.000Z";
    const survivor = sheet(await getAllDocuments(), LIVE_REPORT)!;
    expect(survivor).toBeDefined();
    expect(survivor.reference).toBe("00092");
    expect(survivor.customer?.name).toBe("Patrick Kelleher");
    expect(survivor.jobDeleted).toBe(true);
  });
});
