"use client";

/**
 * Follow-up ⇄ parent visit context, both directions.
 *
 * A follow-up job carries `parent_job_id` pointing at the job whose
 * service sheet it follows up on (set server-side by
 * approveServiceSheetAction → createBooking; nothing here writes it).
 * Until now that link was invisible to the operator — the reference
 * number went blue and that was it. On site, the question is "what did
 * we find last time?", so:
 *
 *   <FollowingUpOnPanel>    child → parent. The panel on the follow-up's
 *                           detail page: whose visit, when, and an INLINE
 *                           summary of the previous sheet, plus a link to
 *                           the full read-only sheet.
 *   <FollowUpScheduledNote> parent → child. One line on the original
 *                           visit's page pointing at the follow-up.
 *
 * Both are display-only and read rows the caller has already pulled from
 * Dexie, so both work offline. Products go through the OPERATOR helper —
 * this is Nate's own screen, so he sees BRAND names (the customer-facing
 * chemical-only helper is for the PDF; see lib/products/render.ts).
 */

import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { formatCallType } from "@/lib/constants/job-labels";
import { renderProductsForOperator } from "@/lib/products/render";
import type { Job } from "@/types/database";

/** "15 Jun 2026" — compact, unambiguous, matches the jobs list. */
function formatVisitDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The summary fields, in the order they matter on a doorstep: what was
 * found, what was done, what was put down, anything else noted. Each is
 * omitted when blank, so a survey visit with no treatment shows two rows
 * rather than four empty ones.
 *
 * Deliberately NOT the whole sheet — no risk assessment, environmental
 * section, methods, photos or signatures. Those are one tap away behind
 * "View previous sheet"; duplicating them here would bury the summary.
 */
function summaryFields(
  parent: Job
): Array<{ label: string; value: string }> {
  const products = renderProductsForOperator(
    parent.products_used,
    parent.pesticides_used
  );
  return [
    { label: "Findings", value: parent.findings ?? "" },
    { label: "Treatment", value: parent.treatment ?? "" },
    { label: "Products used", value: products },
    { label: "Notes", value: parent.report_notes ?? "" },
  ].filter((f) => f.value.trim().length > 0);
}

export function FollowingUpOnPanel({
  parent,
  customerName,
}: {
  /** The parent job, already read from Dexie by the caller. */
  parent: Job;
  /** Parent + follow-up always share a site, hence a customer — the
   *  caller has it resolved. Falls back to a neutral phrase if not. */
  customerName?: string | null;
}) {
  const fields = summaryFields(parent);
  const who = customerName?.trim() || "this customer";

  return (
    <section
      aria-label="Following up on"
      className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-blue-900">
            {`Following up on: ${who} — visit of ${formatVisitDate(
              parent.job_date
            )}`}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-blue-800/80">
            {parent.reference_number && (
              <Link
                href={ROUTES.jobDetail(parent.id)}
                className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 hover:bg-white"
              >
                {parent.reference_number}
              </Link>
            )}
            {parent.call_type && (
              <span>
                {formatCallType(parent.call_type, parent.call_type_other_desc)}
              </span>
            )}
            {parent.pest_species.length > 0 && (
              <span>· {parent.pest_species.join(", ")}</span>
            )}
          </p>
        </div>
        {/* → the read-only sheet for a completed job (Dexie-backed, so it
            opens offline). The parent's own detail page — reachable via
            the reference chip above — is where its PDF lives, which needs
            a network round-trip we deliberately don't make from here. */}
        <Link
          href={`${ROUTES.jobDetail(parent.id)}/complete`}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all duration-75 hover:bg-blue-700 active:scale-95"
        >
          View previous sheet →
        </Link>
      </div>

      {fields.length > 0 ? (
        <dl className="mt-3 space-y-2 border-t border-blue-200/70 pt-3">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-blue-700/70">
                {f.label}
              </dt>
              <dd className="line-clamp-3 whitespace-pre-wrap text-sm text-blue-950">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 border-t border-blue-200/70 pt-3 text-xs text-blue-800/70">
          That visit&apos;s sheet has no findings recorded yet.
        </p>
      )}
    </section>
  );
}

/**
 * Reverse link on the ORIGINAL visit: "Follow-up scheduled: <date>".
 *
 * Cheap because the caller finds the children through the `site_id`
 * index (a follow-up is always booked on its parent's site) rather than
 * scanning the jobs table — `parent_job_id` is not a Dexie index and
 * adding one would mean a schema version bump.
 */
export function FollowUpScheduledNote({ followUps }: { followUps: Job[] }) {
  if (followUps.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5">
      <ul className="space-y-1">
        {followUps.map((f) => (
          <li key={f.id} className="text-xs text-gray-600">
            {"Follow-up scheduled: "}
            <Link
              href={ROUTES.jobDetail(f.id)}
              className="font-medium text-brand-darker hover:underline"
            >
              {formatVisitDate(f.job_date)}
            </Link>
            {f.reference_number && (
              <span className="ml-1.5 font-mono text-[10px] text-gray-400">
                {f.reference_number}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
