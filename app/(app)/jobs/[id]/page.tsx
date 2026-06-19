"use client";

/**
 * Job detail — step 7 conversion.
 *
 * Reads job / site / customer from IndexedDB via `useLiveQuery`. The
 * page re-renders automatically when the wrapped status action flips
 * `job_status` locally OR when a pull brings updated values down from
 * the server. No more RSC re-fetch on every navigation.
 *
 * Loading-vs-not-found convention:
 *   - `undefined` → useLiveQuery hasn't returned yet (loading skeleton)
 *   - `null`      → confirmed absent locally (not-found UI)
 *   - row object  → render it
 *
 * Soft-deleted rows are treated as not-found at the read site,
 * mirroring the server-side RLS filter (audit decision).
 *
 * Reports are not in the syncable Dexie set (audit decision). The
 * report metadata is fetched server-side once per online mount and
 * kept in component state. Offline = no report = placeholder UI in
 * <ReportActions>.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { getReportByJobIdAction } from "@/app/(app)/jobs/[id]/actions";
import { ROUTES } from "@/lib/constants/routes";
import {
  CALL_TYPE_LABELS,
  RISK_LEVEL_LABELS,
  RISK_COLORS,
} from "@/lib/constants/job-labels";
import { ReportActions } from "@/components/jobs/report-actions";
import { isServiceSheetFilled } from "@/lib/validation/service-sheet";
import { JobStatusActions } from "@/components/jobs/job-status-actions";
import { DeleteJobConfirm } from "@/components/jobs/delete-job-confirm";
import { CreateInvoiceButton } from "@/components/invoices/create-invoice-button";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import { SmartBackButton } from "@/components/smart-back-button";
import type { Job, Report } from "@/types/database";

// ─── Section primitives (unchanged from RSC version) ────────────────

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-gray-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function VisitDetailsSection({ job }: { job: Job }) {
  return (
    <SectionCard title="Visit Details">
      <dl className="space-y-3">
        <DetailField
          label="Date"
          value={new Date(job.job_date).toLocaleDateString()}
        />
        {job.call_type && (
          <DetailField
            label="Call Type"
            value={CALL_TYPE_LABELS[job.call_type] ?? job.call_type}
          />
        )}
        {job.pest_species.length > 0 && (
          <div>
            <dt className="text-xs text-gray-400">Pest Species</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {job.pest_species.map((pest) => (
                <span
                  key={pest}
                  className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                >
                  {pest}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </SectionCard>
  );
}

function FindingsSection({ job }: { job: Job }) {
  const hasContent = job.findings || job.recommendations;
  return (
    <SectionCard title="Findings">
      {hasContent ? (
        <dl className="space-y-4">
          {job.findings && <DetailField label="Findings" value={job.findings} />}
          {job.recommendations && (
            <DetailField label="Recommendations" value={job.recommendations} />
          )}
          {job.report_notes && (
            <DetailField label="Report Notes" value={job.report_notes} />
          )}
        </dl>
      ) : (
        <p className="text-sm text-gray-400">No findings recorded.</p>
      )}
    </SectionCard>
  );
}

function TreatmentSection({ job }: { job: Job }) {
  return (
    <SectionCard title="Treatment">
      {job.treatment ? (
        <dl>
          <DetailField label="Treatment Carried Out" value={job.treatment} />
        </dl>
      ) : (
        <p className="text-sm text-gray-400">No treatment recorded.</p>
      )}
      {job.pesticides_used && (
        <dl className="mt-4">
          <DetailField label="Pesticides Used" value={job.pesticides_used} />
        </dl>
      )}
    </SectionCard>
  );
}

function RiskSection({ job }: { job: Job }) {
  return (
    <SectionCard title="Risk Assessment">
      {job.risk_level ? (
        <dl className="space-y-4">
          <div>
            <dt className="text-xs text-gray-400">Risk Level</dt>
            <dd className="mt-1">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${RISK_COLORS[job.risk_level] ?? "bg-gray-100 text-gray-700"}`}
              >
                {RISK_LEVEL_LABELS[job.risk_level] ?? job.risk_level}
              </span>
            </dd>
          </div>
          {job.risk_comments && (
            <DetailField label="Risk Assessment Comments" value={job.risk_comments} />
          )}
        </dl>
      ) : (
        <p className="text-sm text-gray-400">No risk assessment.</p>
      )}
    </SectionCard>
  );
}

function PhotosSection({ job }: { job: Job }) {
  if (!job.photo_urls || job.photo_urls.length === 0) return null;
  return (
    <SectionCard title={`Photos (${job.photo_urls.length})`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {job.photo_urls.map((url, idx) => (
          <a
            key={`${url}-${idx}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border border-gray-200 bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Photo ${idx + 1}`}
              className="aspect-square w-full object-cover"
            />
          </a>
        ))}
      </div>
    </SectionCard>
  );
}

function TreatmentMethodsSection({ job }: { job: Job }) {
  if (!job.method_used || job.method_used.length === 0) return null;
  return (
    <SectionCard title="Treatment">
      <div className="flex flex-wrap gap-1.5">
        {job.method_used.map((m) => (
          <span
            key={m}
            className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
          >
            {m}
          </span>
        ))}
      </div>
      {job.pesticides_used && (
        <dl className="mt-4">
          <DetailField label="Pesticides Used" value={job.pesticides_used} />
        </dl>
      )}
    </SectionCard>
  );
}

function SignaturesSection({ job }: { job: Job }) {
  if (!job.technician_signature_url && !job.client_signature_url) {
    return null;
  }
  return (
    <SectionCard title="Signatures">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {job.technician_signature_url && (
          <div>
            <p className="text-xs text-gray-400">Technician</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={job.technician_signature_url}
              alt="Technician signature"
              className="mt-1 h-20 rounded border border-gray-100 bg-white object-contain"
            />
          </div>
        )}
        {job.client_signature_url && (
          <div>
            <p className="text-xs text-gray-400">Client</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={job.client_signature_url}
              alt="Client signature"
              className="mt-1 h-20 rounded border border-gray-100 bg-white object-contain"
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Loading + not-found views ──────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-64 rounded bg-gray-100" />
      <div className="mt-2 h-4 w-48 rounded bg-gray-100" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="h-40 rounded-xl bg-gray-100" />
          <div className="h-32 rounded-xl bg-gray-100" />
        </div>
        <div className="space-y-6">
          <div className="h-32 rounded-xl bg-gray-100" />
          <div className="h-40 rounded-xl bg-gray-100" />
        </div>
      </div>
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

// ─── Page ──────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const online = useIsOnline();
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Job — undefined while loading, null if missing-or-soft-deleted, Job otherwise.
  // `async` querier so TypeScript unwraps cleanly to `Job | null` rather than
  // Dexie's `PromiseExtended<Job | null>` wrapper.
  const job = useLiveQuery(
    async () => {
      if (!id) return null;
      const j = await db.jobs.get(id);
      return j && !j.deleted_at ? j : null;
    },
    [id]
  );

  // Site — depends on job.site_id, same loading/missing convention.
  const site = useLiveQuery(
    async () => {
      if (!job?.site_id) return null;
      const s = await db.sites.get(job.site_id);
      return s && !s.deleted_at ? s : null;
    },
    [job?.site_id]
  );

  // Customer — depends on site.customer_id.
  const customer = useLiveQuery(
    async () => {
      if (!site?.customer_id) return null;
      const c = await db.customers.get(site.customer_id);
      return c && !c.deleted_at ? c : null;
    },
    [site?.customer_id]
  );

  // Report — server-only, not in Dexie. Fetch once per online mount.
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoaded, setReportLoaded] = useState(false);
  useEffect(() => {
    if (!id || !online || reportLoaded) return;
    let cancelled = false;
    void getReportByJobIdAction(id).then((r) => {
      if (cancelled) return;
      setReport(r);
      setReportLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, online, reportLoaded]);

  // ─── Render gating ────────────────────────────────────────────────

  // Job hasn't been queried yet, OR we're still waiting on site/customer
  // when the job has those references. Treat all undefineds as loading.
  if (job === undefined) return <PageSkeleton />;
  if (job === null) return <NotFoundView />;

  // job exists; site/customer may still be loading
  const siteLoading = !!job.site_id && site === undefined;
  const customerLoading = !!site?.customer_id && customer === undefined;
  if (siteLoading || customerLoading) return <PageSkeleton />;

  return (
    <div>
      <div className="flex items-center gap-3">
        {site && (
          <SmartBackButton
            fallbackHref={ROUTES.siteDetail(site.id)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          />
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">
              {job.job_status === "completed" ? "Service Sheet" : "Booking"}
              {job.reference_number ? ` ${job.reference_number} ` : " "}
              · {new Date(job.job_date).toLocaleDateString()}
            </h1>
            <JobStatusActions jobId={job.id} currentStatus={job.job_status} />
            {/* "Fill Service Sheet" is a completion affordance — show it for a
                fillable booking only. Completed → done (no link). */}
            {job.job_status !== "completed" && (
              <Link
                href={`${ROUTES.jobDetail(job.id)}/complete`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all duration-75 hover:bg-brand-dark active:scale-95"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 18.549 2.799a2.121 2.121 0 1 1 3 3L10.5 16.846a4.5 4.5 0 0 1-1.897 1.13L6 19l.023-2.606a4.5 4.5 0 0 1 1.13-1.897l9.709-9.71Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                Fill Service Sheet
              </Link>
            )}
            {customer && !job.is_invoiced && (
              <CreateInvoiceButton
                label="Create Invoice"
                presetCustomer={customer}
                presetJobId={job.id}
                presetAmount={job.value ?? null}
                presetDescription={(() => {
                  // Auto-summarise: "Pest control — wasps, mice · 12 Jun 2026"
                  const parts: string[] = [];
                  parts.push("Pest control");
                  if (job.pest_species && job.pest_species.length > 0) {
                    parts.push(`— ${job.pest_species.join(", ")}`);
                  }
                  parts.push(
                    `· ${new Date(job.job_date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`
                  );
                  if (job.reference_number) {
                    parts.push(`(ref ${job.reference_number})`);
                  }
                  return parts.join(" ");
                })()}
              />
            )}
            {job.is_invoiced && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                Invoiced
              </span>
            )}
            <SyncStatePill />
            {/* Soft-delete this job — subtle, destructive-on-hover. Online-only
                for now (mirrors customer delete), so disabled offline. */}
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={!online}
              title={!online ? "Needs internet to delete" : "Delete this job"}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
              Delete
            </button>
          </div>
          {site && (
            <p className="text-sm text-gray-500">{site.address_line_1}</p>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <VisitDetailsSection job={job} />
          <FindingsSection job={job} />
          <PhotosSection job={job} />
          <SignaturesSection job={job} />
        </div>

        <div className="space-y-6">
          <TreatmentMethodsSection job={job} />
          <TreatmentSection job={job} />
          <RiskSection job={job} />

          <SectionCard title="Report">
            <ReportActions
              jobId={job.id}
              existingPdfUrl={report?.pdf_url ?? null}
              sheetFilled={isServiceSheetFilled(job)}
            />
          </SectionCard>

          {(site || customer) && (
            <SectionCard title="Context">
              <dl className="space-y-3">
                {site && (
                  <div>
                    <dt className="text-xs text-gray-400">Site</dt>
                    <dd>
                      <Link
                        href={ROUTES.siteDetail(site.id)}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        {site.address_line_1}
                      </Link>
                    </dd>
                  </div>
                )}
                {customer && (
                  <div>
                    <dt className="text-xs text-gray-400">Customer</dt>
                    <dd>
                      <Link
                        href={ROUTES.customerDetail(customer.id)}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        {customer.name}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </SectionCard>
          )}
        </div>
      </div>

      <DeleteJobConfirm
        jobId={job.id}
        jobLabel={
          job.reference_number ? `job ${job.reference_number}` : "this job"
        }
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          router.push(ROUTES.JOBS);
          router.refresh();
        }}
      />
    </div>
  );
}
