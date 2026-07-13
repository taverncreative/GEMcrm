import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getAgreementWithContext,
  getJobsForAgreement,
} from "@/lib/data/agreements";
import { ROUTES } from "@/lib/constants/routes";
import { proxyAssetUrl } from "@/lib/storage/asset-url";
import { AgreementSend } from "@/components/agreements/agreement-send";
import { formatAddress } from "@/lib/utils/format-address";
import { todayUk } from "@/lib/utils/today-uk";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_COLORS,
  CALL_TYPE_LABELS,
} from "@/lib/constants/job-labels";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { AgreementStatusActions } from "@/components/agreements/agreement-status-actions";
import type { AgreementStatus, CallType, JobStatus } from "@/types/database";

interface AgreementDetailPageProps {
  params: Promise<{ id: string }>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-500">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AgreementDetailPage({
  params,
}: AgreementDetailPageProps) {
  const { id } = await params;
  const agreement = await getAgreementWithContext(id);

  if (!agreement) {
    notFound();
  }

  const jobs = await getJobsForAgreement(id);
  const completedJobs = jobs.filter((j) => j.job_status === "completed").length;
  const scheduledJobs = jobs.filter((j) => j.job_status === "scheduled").length;
  const today = todayUk();
  const nextJob = jobs.find(
    (j) => j.job_date >= today && j.job_status !== "completed"
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={ROUTES.AGREEMENTS}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {customerDisplayName(agreement.customer)}
            </h1>
            <p className="text-sm text-gray-500">
              {/* Headline is the company → keep the contact name on the
                  secondary line alongside the site address. */}
              {[
                customerDisplayName(agreement.customer) !==
                agreement.customer.name
                  ? agreement.customer.name
                  : null,
                formatAddress(agreement.site) || null,
              ]
                .filter(Boolean)
                .join(" · ") || "Agreement"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              AGREEMENT_STATUS_COLORS[agreement.status as AgreementStatus]
            }`}
          >
            {AGREEMENT_STATUS_LABELS[agreement.status as AgreementStatus]}
          </span>
          <AgreementStatusActions
            agreementId={agreement.id}
            currentStatus={agreement.status as AgreementStatus}
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <SectionCard title="Agreement">
            <dl className="space-y-3">
              <Field
                label="Start Date"
                value={formatDate(agreement.start_date)}
              />
              <Field
                label="Renewal Date"
                value={formatDate(agreement.end_date)}
              />
              <Field
                label="Visits per year"
                value={agreement.visit_frequency ?? "—"}
              />
              <Field
                label="Annual Contract Value"
                value={
                  agreement.contract_value
                    ? `£${Number(agreement.contract_value).toLocaleString()}`
                    : "—"
                }
              />
              {agreement.pest_species && agreement.pest_species.length > 0 && (
                <div>
                  <dt className="text-xs text-gray-400">Pest Species</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {agreement.pest_species.map((p) => (
                      <span
                        key={p}
                        className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                      >
                        {p}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              {agreement.callout_terms && (
                <Field label="Callout Terms" value={agreement.callout_terms} />
              )}
            </dl>
          </SectionCard>

          <SectionCard title="Contact">
            <dl className="space-y-3">
              {agreement.reference_number && (
                <Field
                  label="GEM Services Reference"
                  value={
                    <span className="font-mono text-xs">
                      {agreement.reference_number}
                    </span>
                  }
                />
              )}
              {agreement.contact_name && (
                <Field label="Company / Owner" value={agreement.contact_name} />
              )}
              {agreement.contact_phone && (
                <Field label="Telephone" value={agreement.contact_phone} />
              )}
              {agreement.mobile && (
                <Field label="Mobile" value={agreement.mobile} />
              )}
              {agreement.contact_email && (
                <Field label="Email" value={agreement.contact_email} />
              )}
              {agreement.invoice_address && (
                <Field
                  label="Invoice Address"
                  value={
                    <span className="whitespace-pre-wrap">
                      {agreement.invoice_address}
                    </span>
                  }
                />
              )}
              {!agreement.contact_name &&
                !agreement.contact_phone &&
                !agreement.contact_email &&
                !agreement.invoice_address && (
                  <p className="text-sm text-gray-400">
                    No contact details recorded.
                  </p>
                )}
            </dl>
          </SectionCard>

          <SectionCard title="Signatures">
            {agreement.client_signature_url || agreement.gem_signature_url ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {agreement.gem_signature_url && (
                  <div>
                    <p className="text-xs text-gray-400">GEM Services</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proxyAssetUrl(agreement.gem_signature_url) ?? agreement.gem_signature_url}
                      alt="GEM signature"
                      className="mt-1 h-20 rounded border border-gray-100 bg-white object-contain"
                    />
                  </div>
                )}
                {agreement.client_signature_url && (
                  <div>
                    <p className="text-xs text-gray-400">
                      {agreement.client_signatory_name ?? "Client"}
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proxyAssetUrl(agreement.client_signature_url) ?? agreement.client_signature_url}
                      alt="Client signature"
                      className="mt-1 h-20 rounded border border-gray-100 bg-white object-contain"
                    />
                  </div>
                )}
                {agreement.signed_date && (
                  <Field
                    label="Signed On"
                    value={formatDate(agreement.signed_date)}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Not signed.</p>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Summary">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Scheduled</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {scheduledJobs}
                </p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Completed</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {completedJobs}
                </p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Total</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {jobs.length}
                </p>
              </div>
            </div>
            {nextJob && (
              <div className="mt-4 rounded-lg border border-brand-soft bg-brand-soft p-3 text-sm">
                <p className="text-xs uppercase tracking-wider text-brand-darker">
                  Next visit
                </p>
                <Link
                  href={ROUTES.jobDetail(nextJob.id)}
                  className="mt-1 block font-medium text-brand-darker hover:underline"
                >
                  {formatDate(nextJob.job_date)}
                </Link>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`Visits (${jobs.length})`}
            action={
              <Link
                href={ROUTES.siteDetail(agreement.site_id)}
                className="text-xs font-medium text-brand-darker hover:text-brand-darker"
              >
                View site →
              </Link>
            }
          >
            {jobs.length === 0 ? (
              <p className="text-sm text-gray-400">
                No visits scheduled yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={ROUTES.jobDetail(job.id)}
                      className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">
                        {formatDate(job.job_date)}
                      </span>
                      <span className="flex items-center gap-2">
                        {job.call_type && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            {CALL_TYPE_LABELS[job.call_type as CallType] ??
                              job.call_type}
                          </span>
                        )}
                        <JobStatusBadge status={job.job_status as JobStatus} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Documents">
            {agreement.contract_pdf_url ? (
              <a
                href={proxyAssetUrl(agreement.contract_pdf_url) ?? agreement.contract_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg
                  className="h-4 w-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
                View contract PDF
              </a>
            ) : (
              <p className="text-sm text-gray-400">
                No contract document available.
              </p>
            )}
            {agreement.contract_pdf_url && (
              <AgreementSend
                agreementId={agreement.id}
                defaultEmail={agreement.contact_email}
              />
            )}
          </SectionCard>

          <SectionCard title="Context">
            <dl className="space-y-3">
              <Field
                label="Customer"
                value={
                  <Link
                    href={ROUTES.customerDetail(agreement.customer.id)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {customerDisplayName(agreement.customer)}
                  </Link>
                }
              />
              <Field
                label="Site"
                value={
                  <Link
                    href={ROUTES.siteDetail(agreement.site.id)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {formatAddress(agreement.site) ||
                      agreement.site.address_line_1 ||
                      "Site"}
                  </Link>
                }
              />
              <Field
                label="Created"
                value={formatDate(agreement.created_at)}
              />
            </dl>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
