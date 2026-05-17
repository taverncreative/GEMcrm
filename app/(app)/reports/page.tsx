import { Suspense } from "react";
import { getRecentSummaries } from "@/lib/data/daily-stats";
import { getAllDocuments } from "@/lib/data/documents";
import { DocumentsList } from "@/components/reports/documents-list";

async function StatsBlock() {
  const summaries = await getRecentSummaries(30);

  const totalJobs = summaries.reduce((sum, s) => sum + s.jobs_completed, 0);
  const totalTasks = summaries.reduce((sum, s) => sum + s.tasks_completed, 0);
  const daysWorked = summaries.length;
  const avgJobs = daysWorked > 0 ? (totalJobs / daysWorked).toFixed(1) : "0";
  const avgTasks = daysWorked > 0 ? (totalTasks / daysWorked).toFixed(1) : "0";

  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-gray-900">No summaries yet</p>
        <p className="mt-1 text-sm text-gray-500">
          Use Settings → Record today&apos;s summary to start logging stats.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Jobs completed" value={totalJobs} />
        <StatCard label="Tasks completed" value={totalTasks} />
        <StatCard label="Avg jobs/day" value={avgJobs} />
        <StatCard label="Avg tasks/day" value={avgTasks} />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Jobs</th>
                <th className="px-4 py-3 text-right">Tasks</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {summaries.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {new Date(row.summary_date).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {row.jobs_completed}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {row.tasks_completed}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {row.jobs_completed + row.tasks_completed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

async function DocumentsBlock() {
  const items = await getAllDocuments();
  return <DocumentsList items={items} />;
}

export default function ReportsPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Documentation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Invoices, service sheets, agreements and recent activity.
          </p>
        </div>
      </div>

      {/* Documents — primary section */}
      <div className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Documents
        </h2>
        <Suspense
          fallback={
            <div className="rounded-xl bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
              Loading…
            </div>
          }
        >
          <DocumentsBlock />
        </Suspense>
      </div>

      {/* Daily summary — secondary section */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Activity — Last 30 days
          </h2>
          <a
            href="/reports/export"
            download
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </a>
        </div>
        <div className="mt-3">
          <Suspense
            fallback={
              <div className="rounded-xl bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
                Loading…
              </div>
            }
          >
            <StatsBlock />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
    </div>
  );
}
