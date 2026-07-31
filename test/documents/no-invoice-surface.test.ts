/**
 * Slice 2b: the invoice UI is hidden everywhere, the invoice DATA is not.
 *
 * 2a removed every creation path; this pins the removal of every remaining
 * SURFACE. Like its 2a sibling (test/services/no-invoice-creation-path.test.ts)
 * this reads the source tree, because the risk is a surface being wired back
 * up somewhere new — which no behavioural test on one component would catch.
 *
 * The counterpart assertions matter just as much: the needs_invoice checklist
 * must still be fully wired, and nothing here may touch the tables, the
 * numbering sequence, the stored PDFs or jobs.is_invoiced / is_paid. This
 * slice is reversible by design.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return out;
}

/** Non-comment lines only — the doc comments explaining the removal name
 *  these things on purpose and must not trip the guard. */
function codeLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith("//") &&
        !l.startsWith("*") &&
        !l.startsWith("/*")
    );
}

const FILES = sourceFiles();
const rel = (f: string) => f.slice(ROOT.length + 1);

function referencing(needle: string, ...allowed: string[]): string[] {
  return FILES.filter((f) => !allowed.some((a) => f.endsWith(a)))
    .filter((f) => codeLines(f).some((l) => l.includes(needle)))
    .map(rel);
}

describe("the invoice UI surfaces are gone", () => {
  it("Documents has no invoice kind", () => {
    const src = readFileSync(join(ROOT, "lib/data/documents.ts"), "utf8");
    const kind = src.slice(
      src.indexOf("export type DocumentKind"),
      src.indexOf(";", src.indexOf("export type DocumentKind"))
    );
    expect(kind).not.toContain("invoice");
    // And the list no longer queries the table.
    expect(codeLines(join(ROOT, "lib/data/documents.ts")).join("\n")).not.toContain(
      'from("invoices")'
    );
  });

  it("the Documents list renders no invoice tab, rows or actions", () => {
    const lines = codeLines(
      join(ROOT, "components/reports/documents-list.tsx")
    ).join("\n");
    for (const gone of [
      "invoice",
      "Invoice",
      "markInvoicePaidAction",
      "sendInvoiceFollowUpAction",
      "generateInvoicePdfAction",
    ]) {
      expect(lines, `documents-list should not mention ${gone}`).not.toContain(
        gone
      );
    }
  });

  it("the customers table has no Invoices column", () => {
    const lines = codeLines(
      join(ROOT, "components/customers/customers-table.tsx")
    ).join("\n");
    expect(lines).not.toContain("invoiceCount");
    expect(lines).not.toContain("Invoices");
  });

  it("neither delete-impact reads invoices", () => {
    const customers = codeLines(join(ROOT, "lib/data/customers.ts")).join("\n");
    expect(customers).not.toContain('from("invoices")');
    const jobs = codeLines(join(ROOT, "lib/data/jobs.ts")).join("\n");
    expect(jobs).not.toContain('from("invoice_jobs")');
    expect(jobs).not.toContain("invoiceNumber");
  });

  it("the Revenue widget takes only the committed-PMA figure", () => {
    const lines = codeLines(
      join(ROOT, "components/dashboard/revenue-stats.tsx")
    ).join("\n");
    expect(lines).toContain("committedAnnual");
    for (const gone of [
      "revenueToday",
      "revenueYtd",
      "unpaidInvoicesTotal",
      "unpaidJobsCount",
    ]) {
      expect(lines, `Revenue widget should not show ${gone}`).not.toContain(
        gone
      );
    }
  });

  it("the dashboard reads its revenue figure from agreements, not invoices", () => {
    const src = readFileSync(join(ROOT, "app/(app)/dashboard/page.tsx"), "utf8");
    expect(src).toContain("getCommittedAnnualRevenue");
    expect(src).not.toContain("lib/data/invoices");
  });

  it("no page imports the deleted invoice actions module", () => {
    expect(existsSync(join(ROOT, "app/(app)/invoices/actions.ts"))).toBe(false);
    expect(referencing("invoices/actions")).toEqual([]);
  });
});

describe("the needs_invoice checklist is untouched", () => {
  it("every piece of the checklist is still wired", () => {
    for (const f of [
      "lib/actions/needs-invoice.ts",
      "components/dashboard/jobs-to-invoice.tsx",
      "components/jobs/needs-invoice-toggle.tsx",
    ]) {
      expect(existsSync(join(ROOT, f)), `${f} must survive`).toBe(true);
    }

    const jobs = readFileSync(join(ROOT, "lib/data/jobs.ts"), "utf8");
    const fn = jobs.slice(
      jobs.indexOf("export async function getJobsNeedingInvoice"),
      jobs.indexOf("export async function hasJobForSiteOnDate")
    );
    expect(fn).toContain('.eq("needs_invoice", true)');
    expect(fn).not.toContain("is_invoiced");

    // The homepage still renders it, and the outbox still replays the flag.
    const dash = readFileSync(join(ROOT, "app/(app)/dashboard/page.tsx"), "utf8");
    expect(dash).toContain("JobsToInvoice");
    expect(dash).toContain("getJobsNeedingInvoice");
    const registry = readFileSync(join(ROOT, "lib/sync/registry.ts"), "utf8");
    expect(registry).toContain("setJobNeedsInvoiceAction");

    // And the service sheet still offers the checkbox.
    const sheet = readFileSync(
      join(ROOT, "components/jobs/service-sheet-form.tsx"),
      "utf8"
    );
    expect(sheet).toContain("invoice_required");
  });
});

describe("no invoice DATA is touched", () => {
  it("no reachable code deletes from the invoice tables or the sequence", () => {
    // lib/data/invoices.ts is excluded deliberately: it still holds
    // createStandaloneInvoice, whose failed-link rollback deletes the invoice
    // it just made. That function's only caller (createInvoiceDraftAction)
    // was deleted, so it is unreachable dead code awaiting slice 2c — it can
    // never run, and it only ever removed a row it had itself created a
    // moment earlier. Nothing else anywhere may delete invoice data.
    const DEAD_MODULE = "lib/data/invoices.ts";
    for (const needle of [
      'from("invoices").delete',
      'from("invoice_jobs").delete',
      "drop table",
      "invoice_number_seq",
    ]) {
      expect(
        referencing(needle, DEAD_MODULE),
        `nothing reachable should reference ${needle}`
      ).toEqual([]);
    }
  });

  it("this slice adds no migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    // 051 is the newest; 2b is UI-only.
    expect(migrations.some((m) => m.startsWith("052"))).toBe(false);
  });
});
