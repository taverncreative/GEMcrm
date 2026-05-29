"use client";

/**
 * Service-sheet host page — step 7 surface 2.
 *
 * The ServiceSheetForm itself is already wrapped (step 6 commit 9).
 * This page just needs to hand the form its prefill data — same
 * job/site/customer chain as surface 1, same loading-vs-not-found
 * convention.
 *
 * Server reads (RSC) replaced with Dexie + useLiveQuery so the route
 * renders offline.
 *
 * Already-completed handling
 * --------------------------
 * The previous (RSC) page called `redirect()` server-side before any
 * render. Surface-2 step-7 v1 tried to mimic that with a post-mount
 * useEffect + router.replace — that's too late, it fires AFTER the
 * form has mounted and become interactive, so an in-flight pull that
 * flipped status to "completed" would yank the form out from under
 * the operator (modal closes, button vanishes, typing lost).
 *
 * Fix: gate the render directly. If status is "completed" at any
 * point, render a clear "already completed" view with a link to the
 * detail page. No useEffect, no router dance. If the operator was
 * mid-edit when the pull landed they DO lose their in-progress
 * changes — but that's a clear "this got finished elsewhere"
 * message, not a silent yank. Same outcome as the RSC redirect,
 * minus the silent navigation.
 */

import { useParams } from "next/navigation";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import { ROUTES } from "@/lib/constants/routes";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import type { CallType } from "@/types/database";

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

function AlreadyCompletedView({ jobId }: { jobId: string }) {
  return (
    <div className="rounded-xl bg-white p-12 text-center shadow-sm">
      <svg
        className="mx-auto h-12 w-12 text-green-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
      <h2 className="mt-4 text-base font-semibold text-gray-900">
        Service sheet already completed
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        This job has been signed off and finalised. The service sheet is
        viewable on the job detail page.
      </p>
      <Link
        href={ROUTES.jobDetail(jobId)}
        className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
      >
        View service sheet
      </Link>
    </div>
  );
}

export default function CompleteServiceSheetPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";

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

  if (job === undefined) return <PageSkeleton />;
  if (job === null) return <NotFoundView />;

  // Completed-job gate runs BEFORE the form ever mounts. If status
  // changes to "completed" mid-session (rare — another device, or
  // post-approve pull), the form unmounts and this view takes over.
  // The operator's in-progress local edits are lost; the message
  // makes the cause clear.
  if (job.job_status === "completed") {
    return <AlreadyCompletedView jobId={job.id} />;
  }

  const siteLoading = !!job.site_id && site === undefined;
  const customerLoading = !!site?.customer_id && customer === undefined;
  if (siteLoading || customerLoading) return <PageSkeleton />;

  return (
    <div>
      <div className="flex items-start gap-3">
        <Link
          href={ROUTES.jobDetail(id)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
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
          defaultPests={job.pest_species ?? []}
          defaultMethods={job.method_used ?? []}
          defaultRiskLevel={job.risk_level ?? "low"}
          defaultFindings={job.findings ?? ""}
          defaultRecommendations={job.recommendations ?? ""}
          defaultPesticides={job.pesticides_used ?? ""}
          defaultReportNotes={job.report_notes ?? ""}
          customerName={customer?.name}
          customerCompany={customer?.company_name ?? null}
          customerEmail={customer?.email ?? null}
          customerPhone={customer?.phone ?? null}
          siteAddress={
            site
              ? [site.address_line_1, site.town, site.postcode]
                  .filter(Boolean)
                  .join(", ")
              : undefined
          }
        />
      </div>
    </div>
  );
}
