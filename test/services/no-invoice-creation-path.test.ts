/**
 * Structural guard: nothing in the app can create an invoice (slice 2a).
 *
 * The behavioural guard lives in auto-invoice-pdf.test.ts (job completion
 * creates nothing). This one is the belt-and-braces companion: it reads the
 * SOURCE and fails if a creation path is wired back up anywhere, which a
 * behavioural test on one function cannot cover.
 *
 * Why source-reading rather than mocks: the risk being guarded against is
 * someone re-importing `createInvoiceForJob` in a new service, or mounting
 * `InvoiceCreatorModal` on a new page. Neither would break any existing
 * test. Scanning the tree is the only thing that actually notices.
 *
 * Deliberately NOT asserted here: that the invoice modules are deleted.
 * They are not, and that is the plan — slice 2a stops creation only; the
 * remaining invoice UI is hidden in 2b and the dead services tidied in 2c.
 * The 9 existing invoices and their PDFs stay reachable throughout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];

/** Every .ts/.tsx file under the app's own source dirs. */
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

/** Non-comment lines only — the doc comments that explain the removal
 *  mention these names on purpose and must not trip the guard. */
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

/** Files whose code (not comments) references `needle`, excluding the
 *  module that defines it. */
function referencing(needle: string, selfPath: string): string[] {
  return FILES.filter((f) => !f.endsWith(selfPath)).filter((f) =>
    codeLines(f).some((l) => l.includes(needle))
  );
}

const rel = (f: string) => f.slice(ROOT.length + 1);

describe("no invoice creation path remains", () => {
  it("nothing calls createInvoiceForJob (the old auto-generate path)", () => {
    const callers = referencing(
      "createInvoiceForJob",
      "lib/data/invoices.ts"
    ).map(rel);
    expect(callers).toEqual([]);
  });

  it("job-events imports nothing from the invoice modules", () => {
    const src = readFileSync(
      join(ROOT, "lib/services/job-events.ts"),
      "utf8"
    );
    const imports = src
      .split("\n")
      .filter((l) => l.trim().startsWith("import "));
    expect(imports.some((l) => l.includes("lib/data/invoices"))).toBe(false);
    expect(imports.some((l) => l.includes("invoice-pdf"))).toBe(false);
  });

  it("no page or component mounts the invoice creator modal", () => {
    const mounts = referencing(
      "<InvoiceCreatorModal",
      "components/invoices/invoice-creator-modal.tsx"
    ).map(rel);
    // create-invoice-button is itself orphaned (nothing renders it); it is
    // deleted in a later slice, so it is the one allowed holdover.
    expect(mounts).toEqual(["components/invoices/create-invoice-button.tsx"]);
  });

  it("nothing renders the CreateInvoiceButton", () => {
    const users = referencing(
      "CreateInvoiceButton",
      "components/invoices/create-invoice-button.tsx"
    ).map(rel);
    expect(users).toEqual([]);
  });
});

describe("the needs_invoice checklist is independent of the old system", () => {
  const CHECKLIST_FILES = [
    "lib/actions/needs-invoice.ts",
    "components/dashboard/jobs-to-invoice.tsx",
    "components/jobs/needs-invoice-toggle.tsx",
  ];

  it("no checklist file reads is_invoiced or is_paid", () => {
    for (const f of CHECKLIST_FILES) {
      const lines = codeLines(join(ROOT, f));
      expect(
        lines.filter((l) => l.includes("is_invoiced") || l.includes("is_paid")),
        `${f} should not touch the legacy invoice flags`
      ).toEqual([]);
    }
  });

  it("getJobsNeedingInvoice filters on needs_invoice, not is_invoiced", () => {
    const src = readFileSync(join(ROOT, "lib/data/jobs.ts"), "utf8");
    const fn = src.slice(
      src.indexOf("export async function getJobsNeedingInvoice"),
      src.indexOf("export async function hasJobForSiteOnDate")
    );
    expect(fn).toContain('.eq("needs_invoice", true)');
    expect(fn).not.toContain("is_invoiced");
  });
});
