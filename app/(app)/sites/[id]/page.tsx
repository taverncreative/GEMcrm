import { notFound } from "next/navigation";
import Link from "next/link";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { getJobsBySite, getLastJobForSite } from "@/lib/data/jobs";
import { getAgreementsBySite } from "@/lib/data/agreements";
import { QuickBookingForm } from "@/components/jobs/quick-booking-form";
import { AddAgreementForm } from "@/components/agreements/add-agreement-form";
import { ROUTES } from "@/lib/constants/routes";
import { CALL_TYPE_LABELS, AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_COLORS } from "@/lib/constants/job-labels";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";

interface SiteDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?new=agreement` (from the Agreements list front door) opens the
   *  agreement wizard on arrival, so the operator lands straight in it. */
  searchParams?: Promise<{ new?: string }>;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
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

export default async function SiteDetailPage({
  params,
  searchParams,
}: SiteDetailPageProps) {
  const { id } = await params;
  const openAgreementWizard = (await searchParams)?.new === "agreement";
  const site = await getSiteById(id);

  if (!site) {
    notFound();
  }

  const [customer, jobs, agreements, lastJob] = await Promise.all([
    getCustomerById(site.customer_id),
    getJobsBySite(id),
    getAgreementsBySite(id),
    getLastJobForSite(id),
  ]);

  return (
    <div>
      <div className="flex items-center gap-3">
        {customer && (
          <Link
            href={ROUTES.customerDetail(customer.id)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-gray-900">
          {site.address_line_1}
        </h1>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <SectionCard
            title="Site Address"
            action={
              <Link
                href={ROUTES.siteEdit(site.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
                  />
                </svg>
                Edit
              </Link>
            }
          >
            <dl className="space-y-3">
              <DetailField label="Address Line 1" value={site.address_line_1 ?? "—"} />
              {site.address_line_2 && (
                <DetailField label="Address Line 2" value={site.address_line_2} />
              )}
              <DetailField label="Town" value={site.town ?? "—"} />
              <DetailField label="County" value={site.county ?? "—"} />
              <DetailField label="Postcode" value={site.postcode ?? "—"} />
            </dl>
          </SectionCard>

          {customer && (
            <SectionCard title="Customer">
              <Link
                href={ROUTES.customerDetail(customer.id)}
                className="text-sm font-medium text-gray-900 hover:underline"
              >
                {customerDisplayName(customer)}
              </Link>
              {customerDisplayName(customer) !== customer.name && (
                <p className="mt-0.5 text-sm text-gray-500">
                  {customer.name}
                </p>
              )}
            </SectionCard>
          )}

          <div id="booking">
            <SectionCard title="New Booking">
              {(() => {
                const activeAgreement = agreements.find((a) => a.status === "active");
                const hasLastJob = !!lastJob;
                const hasAgreement = !!activeAgreement;

                const defaultPests = hasLastJob
                  ? (lastJob.pest_species ?? undefined)
                  : hasAgreement
                    ? (activeAgreement.pest_species ?? undefined)
                    : undefined;
                const defaultCallType = hasAgreement ? "routine" : undefined;

                return (
                  <>
                    <p className="mb-3 text-xs text-gray-500">
                      Add a visit to the calendar. Fill the Service Sheet on the
                      day of the visit.
                    </p>
                    <QuickBookingForm
                      siteId={id}
                      defaultPests={defaultPests}
                      defaultCallType={defaultCallType}
                    />
                  </>
                );
              })()}
            </SectionCard>
          </div>
        </div>

        <div className="space-y-6">
          <SectionCard title={`Jobs (${jobs.length})`}>
            {jobs.length === 0 ? (
              <p className="text-sm text-gray-400">No jobs recorded at this site.</p>
            ) : (
              <ul className="space-y-2">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={ROUTES.jobDetail(job.id)}
                      className="block rounded-lg border border-gray-100 px-4 py-3 text-sm hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">
                          {new Date(job.job_date).toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-2">
                          <JobStatusBadge status={job.job_status} />
                          {job.call_type && (
                            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                              {CALL_TYPE_LABELS[job.call_type] ?? job.call_type}
                            </span>
                          )}
                        </div>
                      </div>
                      {job.pest_species && job.pest_species.length > 0 && (
                        <p className="mt-1 text-gray-500">
                          {job.pest_species.join(", ")}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <div id="agreements" />
          <SectionCard title={`Agreements (${agreements.length})`}>
            {agreements.length === 0 ? (
              <p className="mb-4 text-sm text-gray-400">No agreements for this site.</p>
            ) : (
              <ul className="mb-4 space-y-2">
                {agreements.map((agreement) => (
                  <li
                    key={agreement.id}
                    className="rounded-lg border border-gray-100 px-4 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {agreement.visit_frequency} visits/year
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${AGREEMENT_STATUS_COLORS[agreement.status]}`}>
                          {AGREEMENT_STATUS_LABELS[agreement.status]}
                        </span>
                      </div>
                      {agreement.start_date && (
                        <span className="text-gray-400">
                          from {new Date(agreement.start_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {agreement.pest_species && agreement.pest_species.length > 0 && (
                      <p className="mt-1 text-gray-500">
                        {agreement.pest_species.join(", ")}
                      </p>
                    )}
                    {agreement.contract_value && (
                      <p className="mt-0.5 text-gray-400">
                        Value: £{Number(agreement.contract_value).toLocaleString()}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <AddAgreementForm
              siteId={id}
              customer={customer}
              defaultOpen={openAgreementWizard}
            />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
