import { notFound } from "next/navigation";
import Link from "next/link";
import { getJobById } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { getReportByJobId } from "@/lib/data/reports";
import { ROUTES } from "@/lib/constants/routes";
import {
  CALL_TYPE_LABELS,
  RISK_LEVEL_LABELS,
  RISK_COLORS,
} from "@/lib/constants/job-labels";
import { ReportActions } from "@/components/jobs/report-actions";
import { JobStatusActions } from "@/components/jobs/job-status-actions";
import { CreateInvoiceButton } from "@/components/invoices/create-invoice-button";
import type { Job } from "@/types/database";

interface JobDetailPageProps {
  params: Promise<{ id: string }>;
}

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

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    notFound();
  }

  const [site, report] = await Promise.all([
    getSiteById(job.site_id),
    getReportByJobId(id),
  ]);
  const customer = site ? await getCustomerById(site.customer_id) : null;

  return (
    <div>
      <div className="flex items-center gap-3">
        {site && (
          <Link
            href={ROUTES.siteDetail(site.id)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">
              {job.job_status === "completed" ? "Service Sheet" : "Booking"}
              {job.reference_number ? ` ${job.reference_number} ` : " "}
              · {new Date(job.job_date).toLocaleDateString()}
            </h1>
            <JobStatusActions jobId={job.id} currentStatus={job.job_status} />
            {job.job_status !== "completed" && (
              <Link
                href={`${ROUTES.jobDetail(job.id)}/complete`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand-dark"
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
    </div>
  );
}
