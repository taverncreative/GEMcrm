import { requireUser } from "@/lib/auth/require-user";
import {
  RenewalCheckButton,
  SignOutButton,
} from "@/components/settings/settings-actions";
import { FeatureRequestForm } from "@/components/settings/feature-request-form";
import { getRecentFeatureRequests } from "@/lib/data/feature-requests";
import { BUSINESS } from "@/lib/constants/branding";

const TYPE_LABEL: Record<string, string> = {
  feature: "Feature",
  bug: "Bug",
  change: "Change",
};

const TYPE_COLOR: Record<string, string> = {
  feature: "bg-brand-soft text-brand-darker",
  bug: "bg-red-100 text-red-700",
  change: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  addressed: "Addressed",
  declined: "Declined",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  addressed: "bg-blue-100 text-blue-700",
  declined: "bg-gray-100 text-gray-500",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-base font-medium text-gray-900">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const requests = await getRecentFeatureRequests(20);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Account, requests, and routine maintenance tasks.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Account */}
        <SectionCard title="Account">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-400">Email</dt>
              <dd className="mt-0.5 text-gray-900">
                {user.email ?? "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">User ID</dt>
              <dd className="mt-0.5 font-mono text-xs text-gray-500">
                {user.id}
              </dd>
            </div>
            {user.created_at && (
              <div>
                <dt className="text-xs text-gray-400">Member since</dt>
                <dd className="mt-0.5 text-gray-900">
                  {formatDate(user.created_at)}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-5 border-t border-gray-100 pt-4">
            <SignOutButton />
          </div>
        </SectionCard>

        {/* Feature / bug requests — replaces the old "Today" tile */}
        <SectionCard
          title="Request a change"
          description="Submit a feature idea, bug report, or change request. Goes straight to the developer."
        >
          <FeatureRequestForm currentUserEmail={user.email ?? undefined} />
        </SectionCard>

        {/* Contract renewals */}
        <SectionCard
          title="Contract renewals"
          description="Scan active agreements ending within 30 days and create renewal tasks for any that don't already have one."
        >
          <RenewalCheckButton />
        </SectionCard>

        {/* About */}
        <SectionCard title="About">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-400">Product</dt>
              <dd className="mt-0.5 text-gray-900">{BUSINESS.name} CRM</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Developer</dt>
              <dd className="mt-0.5 text-gray-900">
                BSK — Business Sorted Kent
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Contact</dt>
              <dd className="mt-0.5">
                <a
                  href={`mailto:${BUSINESS.supportEmail}`}
                  className="text-brand-darker hover:underline"
                >
                  {BUSINESS.supportEmail}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Environment</dt>
              <dd className="mt-0.5 text-gray-900">
                {process.env.NODE_ENV === "production"
                  ? "Production"
                  : "Development"}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>

      {/* Past requests */}
      <div className="mt-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Past requests
        </h2>
        {requests.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center text-sm text-gray-500 shadow-sm">
            No requests yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="whitespace-nowrap px-4 py-3">Date</th>
                    <th className="whitespace-nowrap px-4 py-3">Type</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="whitespace-nowrap px-4 py-3">From</th>
                    <th className="whitespace-nowrap px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {formatDate(r.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            TYPE_COLOR[r.request_type] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {TYPE_LABEL[r.request_type] ?? r.request_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-800">{r.message}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {r.submitter_email ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
