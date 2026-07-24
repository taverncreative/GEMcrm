"use client";

/**
 * Service-sheet host page — step 7 surface 2.
 *
 * The ServiceSheetForm itself is already wrapped (step 6 commit 9).
 * This page hands the form its prefill data — same job/site/customer
 * chain as surface 1, same loading-vs-not-found convention.
 *
 * Server reads (RSC) replaced with Dexie + useLiveQuery so the route
 * renders offline.
 *
 * Editable vs view-only gate (WHITELIST)
 * --------------------------------------
 * The form is rendered ONLY when the job is in a fill-able status —
 * `scheduled` or `in_progress`. Every other status (currently just
 * `completed`, but a new status would default to locked) renders the
 * read-only `ServiceSheetViewOnly` display.
 *
 * Why a whitelist (and not a `=== "completed"` blacklist):
 *
 *   1. **Structural safety.** A blacklist needs an exhaustive list of
 *      forbidden statuses; if a new status is added later (eg.
 *      "cancelled", "on_hold") and the blacklist isn't updated, the
 *      editable form silently opens. A whitelist defaults the wrong
 *      way around: unknown statuses → locked, which is the correct
 *      bias for "can the operator overwrite committed data?".
 *   2. **Race-window closure.** Reported bug: after `Approve`, the
 *      route was momentarily reachable in editable form via browser
 *      back / URL because `useLiveQuery`'s emit can be deferred
 *      inside a React 19 transition (handleApprove runs `await db
 *      .jobs.update(..., {job_status:"completed"})` inside
 *      `startTransition`, so the page's re-render to the gate is
 *      transitional — it can land AFTER `router.push`). The
 *      whitelist closes the window even if the gate's re-render
 *      arrives late: the form never instantiates without an
 *      affirmative fill-able status reading.
 *   3. **Forward-compat for a correction path.** When we add an
 *      "Add correction" button later, the view-only state is the
 *      host. Keeping the whitelist makes "correction" a third path
 *      (alongside scheduled/in_progress and locked-view-only)
 *      rather than something tangled into the gate.
 *
 * Status enum confirmed exhaustive (types/database.ts: JobStatus +
 * supabase CHECK constraint): `scheduled | in_progress | completed`.
 * No `reopened` / `revisit` / `cancelled` exist. If one is added
 * later, decide whether it's fill-able in the constant below.
 *
 * Loading-state contract
 * ----------------------
 * `job === undefined` → `<PageSkeleton />`. Neutral — does NOT
 * render the form pre-emptively. Without the skeleton gate, the form
 * could briefly mount on a yet-to-load status reading and run its
 * draft auto-save effect against a possibly-completed job.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { ServiceSheetViewOnly } from "@/components/jobs/service-sheet-view-only";
import { ServiceSheetGate } from "@/components/jobs/service-sheet-gate";
import { customerServiceSheetReadiness } from "@/lib/documents/service-sheet-readiness";
import {
  resolveSheetAddress,
  formatSheetAddress,
} from "@/lib/documents/resolve-sheet-address";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import { SmartBackButton } from "@/components/smart-back-button";
import { ROUTES } from "@/lib/constants/routes";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import type { CallType, JobStatus } from "@/types/database";

/**
 * The whitelist. ANY job status not in this set renders view-only.
 *
 * Source of truth for the enum is `types/database.ts` (JobStatus) and
 * the SQL `jobs.job_status` CHECK constraint. If either gains a new
 * value, decide here whether it permits a service-sheet fill.
 *
 * Kept as a Set<string> rather than Set<JobStatus> so a status read
 * from Dexie that happens to be an unexpected string (corruption,
 * pre-validation server response, etc.) defaults to "not fill-able"
 * rather than getting type-narrowed past the guard.
 */
const FILLABLE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "scheduled",
  "in_progress",
]);

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function PageSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-64 rounded bg-gray-100" />
      <div className="mt-2 h-4 w-80 rounded bg-gray-100" />
      <div className="mt-6 h-96 rounded-xl bg-gray-100" />
    </div>
  );
}

function NotFoundView() {
  return (
    <div className="rounded-xl bg-white p-12 text-center shadow-sm">
      <p className="text-sm text-gray-500">
        This job isn&apos;t available locally. It may have been deleted, or
        your local data may not have caught up yet.
      </p>
      <Link
        href={ROUTES.JOBS}
        className="mt-4 inline-block text-sm font-medium text-brand-darker hover:underline"
      >
        ← Back to jobs
      </Link>
    </div>
  );
}

// AlreadyCompletedView removed — replaced by the richer
// `ServiceSheetViewOnly` component which actually shows the saved sheet
// rather than a bare "go to detail" link. See the page-level docstring
// for the gate-rewrite rationale.

export default function CompleteServiceSheetPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";

  // L2 amend flow: an explicit operator choice ("Amend sheet" on the
  // view-only banner) swaps in the editable form for a COMPLETED job.
  // Defaults false, so the whitelist gate below still renders completed
  // sheets view-only — including during the post-approve race window
  // the gate tests pin. Amend never touches job_status; the form
  // submits with amend="true" instead of finalize.
  const [amending, setAmending] = useState(false);

  const job = useLiveQuery(
    async () => {
      if (!id) return null;
      const j = await db.jobs.get(id);
      return j && !j.deleted_at ? j : null;
    },
    [id]
  );

  const site = useLiveQuery(
    async () => {
      if (!job?.site_id) return null;
      const s = await db.sites.get(job.site_id);
      return s && !s.deleted_at ? s : null;
    },
    [job?.site_id]
  );

  const customer = useLiveQuery(
    async () => {
      if (!site?.customer_id) return null;
      const c = await db.customers.get(site.customer_id);
      return c && !c.deleted_at ? c : null;
    },
    [site?.customer_id]
  );

  // ─── Render gating ────────────────────────────────────────────────
  //
  // Order matters:
  //   1. job loading (undefined)              → neutral skeleton
  //   2. job missing locally (null)           → not-found
  //   3. site / customer loading              → neutral skeleton
  //   4. job's status NOT in the whitelist    → view-only
  //   5. fall through                         → editable form
  //
  // The site/customer skeleton (step 3) sits BEFORE the whitelist
  // because both views consume customer/site context. Without this
  // ordering the view-only header could briefly render "—" for the
  // customer name on cold mount.
  //
  // Step 4's whitelist closes the post-approve race window: even if
  // `useLiveQuery` momentarily returns a stale "in_progress" reading
  // after the approve transition commits (and React 19 defers the
  // re-render to "completed"), the form's mount is gated on an
  // affirmative fill-able status check. The view-only renders for
  // anything else.

  if (job === undefined) return <PageSkeleton />;
  if (job === null) return <NotFoundView />;

  const siteLoading = !!job.site_id && site === undefined;
  const customerLoading = !!site?.customer_id && customer === undefined;
  if (siteLoading || customerLoading) return <PageSkeleton />;

  // Amend applies ONLY to completed jobs (an unknown/locked status must
  // not become editable through the amend door either).
  const amendMode = job.job_status === "completed" && amending;

  if (!FILLABLE_STATUSES.has(job.job_status) && !amendMode) {
    return (
      <div>
        <div className="flex items-start gap-3">
          <SmartBackButton
            fallbackHref={ROUTES.jobDetail(id)}
            label="Back to job"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-gray-900">
                Service Sheet
              </h1>
              <SyncStatePill />
            </div>
            <p className="text-sm text-gray-500">
              {customer ? customer.name : "Customer"}
              {" · "}
              {formatDate(job.job_date)}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <ServiceSheetViewOnly
            job={job}
            site={site}
            customer={customer}
            onAmend={
              job.job_status === "completed"
                ? () => setAmending(true)
                : undefined
            }
          />
        </div>
      </div>
    );
  }

  // ─── Completeness gate ──────────────────────────────────────────────
  // Before the form mounts, the job's customer + site must carry the
  // details the printed sheet needs (name/phone/email + a usable site
  // address). An under-filled (relaxed-booking) customer is blocked with
  // the missing items and routed to fix them; a fully-filled one falls
  // straight through. Gated at the page (not the button) so a direct
  // navigation to /complete is caught too. Supersedes the old soft
  // "no email" banner — the gate now requires email outright.
  // By this point the loading gates above guarantee customer/site are
  // resolved (or genuinely absent → null); coerce undefined → null so the
  // pure rule and the gate see a clean shape.
  const gateCustomer = customer ?? null;
  const gateSite = site ?? null;
  const readiness = customerServiceSheetReadiness(gateCustomer, gateSite);
  if (!readiness.ready) {
    return (
      <div>
        <div className="flex items-start gap-3">
          <SmartBackButton
            fallbackHref={ROUTES.jobDetail(id)}
            label="Back to job"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-gray-900">
                Service Sheet
              </h1>
              <SyncStatePill />
            </div>
            <p className="text-sm text-gray-500">
              {customer ? customer.name : "Customer"}
              {" · "}
              {formatDate(job.job_date)}
            </p>
          </div>
        </div>

        <ServiceSheetGate
          customer={gateCustomer}
          site={gateSite}
          missing={readiness.missing}
          jobId={id}
        />
      </div>
    );
  }

  // Location that prints on the sheet: the job's site if it has an address,
  // else the customer's own address block (so a bare quick-add site doesn't
  // re-ask). Same resolution the gate above passed on.
  const resolvedAddress = resolveSheetAddress(gateSite, gateCustomer);

  return (
    <div>
      <div className="flex items-start gap-3">
        <SmartBackButton
          fallbackHref={ROUTES.jobDetail(id)}
          label="Back to job"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">
              Service Sheet
            </h1>
            <SyncStatePill />
          </div>
          <p className="text-sm text-gray-500">
            {customer ? customer.name : "Customer"}
            {" · "}
            {formatDate(job.job_date)}
            {job.call_type
              ? ` · ${CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type}`
              : ""}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <ServiceSheetForm
          jobId={job.id}
          defaultCallType={job.call_type ?? ""}
          defaultCallTypeOtherDesc={job.call_type_other_desc ?? ""}
          defaultPests={job.pest_species ?? []}
          defaultMethods={job.method_used ?? []}
          defaultRiskLevel={job.risk_level ?? "low"}
          defaultFindings={job.findings ?? ""}
          defaultRecommendations={job.recommendations ?? ""}
          defaultProducts={job.products_used ?? []}
          defaultReportNotes={job.report_notes ?? ""}
          defaultRiskComments={job.risk_comments ?? ""}
          customerName={customer?.name}
          customerCompany={customer?.company_name ?? null}
          customerEmail={customer?.email ?? null}
          customerPhone={customer?.phone ?? null}
          siteAddress={
            resolvedAddress.source !== "none"
              ? formatSheetAddress(resolvedAddress)
              : undefined
          }
          addressFromCustomer={resolvedAddress.source === "customer"}
          siteId={job.site_id ?? undefined}
          mode={amendMode ? "amend" : "fill"}
          customerId={customer?.id}
        />
      </div>
    </div>
  );
}
