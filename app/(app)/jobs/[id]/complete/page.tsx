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
 * renders offline. The pre-filled fields (call_type, pest_species,
 * findings, etc) are exactly what the form needs to display its
 * "carry forward from last visit" defaults — those carried over from
 * the previous job state, which the pull has into Dexie.
 *
 * If the job is already completed the page used to `redirect()` to
 * the detail page server-side. From a client component we use
 * `useRouter().replace()` post-mount instead. There's a brief flash
 * of the skeleton in this case; acceptable for the rare path.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
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

export default function CompleteServiceSheetPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

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

  // Already-completed jobs bounce back to the detail page — the form
  // would just rewrite a finalised sheet. Replaces (not pushes) so the
  // back button skips this URL.
  useEffect(() => {
    if (job?.job_status === "completed") {
      router.replace(ROUTES.jobDetail(job.id));
    }
  }, [job, router]);

  if (job === undefined) return <PageSkeleton />;
  if (job === null) return <NotFoundView />;
  // While the redirect effect is in flight, keep the skeleton up.
  if (job.job_status === "completed") return <PageSkeleton />;

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
