import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getJobById } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { ROUTES } from "@/lib/constants/routes";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import type { CallType } from "@/types/database";

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function CompleteServiceSheetPage({ params }: Props) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) notFound();

  // If the job is already completed, send the user back to the detail page.
  if (job.job_status === "completed") {
    redirect(ROUTES.jobDetail(id));
  }

  const site = await getSiteById(job.site_id);
  const customer = site ? await getCustomerById(site.customer_id) : null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Link
          href={ROUTES.jobDetail(id)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Service Sheet
          </h1>
          <p className="text-sm text-gray-500">
            {customer ? customer.name : "Customer"}
            {" · "}
            {formatDate(job.job_date)}
            {job.call_type ? ` · ${CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type}` : ""}
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
