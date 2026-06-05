import { notFound } from "next/navigation";
import Link from "next/link";
import { getCustomerById } from "@/lib/data/customers";
import { getSitesByCustomer } from "@/lib/data/sites";
import { getAgreementsByCustomer } from "@/lib/data/agreements";
import { AddSiteForm } from "@/components/sites/add-site-form";
import { SmartBackButton } from "@/components/smart-back-button";
import { formatAddress } from "@/lib/utils/format-address";
import { ROUTES } from "@/lib/constants/routes";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_COLORS } from "@/lib/constants/job-labels";

interface CustomerDetailPageProps {
  params: Promise<{ id: string }>;
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

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { id } = await params;
  const [customer, sites, agreements] = await Promise.all([
    getCustomerById(id),
    getSitesByCustomer(id),
    getAgreementsByCustomer(id),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <SmartBackButton
          fallbackHref={ROUTES.CUSTOMERS}
          label="Back to customers"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        />
        <h1 className="text-2xl font-semibold text-gray-900">
          {customer.name}
        </h1>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <SectionCard title="Customer Details">
            <dl className="space-y-3">
              <DetailField label="Name" value={customer.name} />
              {customer.company_name && (
                <DetailField label="Company" value={customer.company_name} />
              )}
              {customer.email && (
                <DetailField label="Email" value={customer.email} />
              )}
              {customer.phone && (
                <DetailField label="Phone" value={customer.phone} />
              )}
              <DetailField
                label="Added"
                value={new Date(customer.created_at).toLocaleDateString()}
              />
            </dl>
          </SectionCard>

          <SectionCard title="Add Site">
            <AddSiteForm customerId={customer.id} />
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <SectionCard title={`Sites (${sites.length})`}>
            {sites.length === 0 ? (
              <p className="text-sm text-gray-400">No sites added yet.</p>
            ) : (
              <ul className="space-y-2">
                {sites.map((site) => (
                  <li key={site.id}>
                    <Link
                      href={ROUTES.siteDetail(site.id)}
                      className="block rounded-lg border border-gray-100 px-4 py-3 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">
                        {site.address_line_1}
                      </span>
                      <span className="mt-0.5 block text-gray-500">
                        {formatAddress(site)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={`Agreements (${agreements.length})`}>
            {agreements.length === 0 ? (
              <p className="text-sm text-gray-400">No agreements yet.</p>
            ) : (
              <ul className="space-y-2">
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
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
