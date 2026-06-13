"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ROUTES } from "@/lib/constants/routes";

/**
 * Quick-capture drafts awaiting upgrade to a real booking (Q3).
 *
 * Client island — reads Dexie via useLiveQuery so it's offline-checkable
 * (mirrors the jobs-list Drafts tab predicate exactly: job_status='draft'
 * AND not soft-deleted AND not archived, newest date first). The count and
 * rows update the instant a draft is captured or upgraded locally, with no
 * server round-trip.
 *
 * Structure deliberately matches <ServiceSheetsToFill>: a self-contained
 * card (WidgetFrame supplies only the hover chrome, not a title), a
 * zero-state that SHOWS rather than hides, a per-row tap target straight to
 * the action screen — here the upgrade flow (/jobs/[id]/upgrade, live from
 * Pass 1) — and a "View all" footer past five. Drafts carry no customer/
 * site, so each row shows the captured phrase (capture_note), like the
 * Drafts tab.
 */
export function DraftsToUpgrade() {
  const drafts = useLiveQuery(async () => {
    const all = await db.jobs
      .where("job_status")
      .equals("draft")
      .toArray();
    return all
      .filter((j) => !j.deleted_at && !j.is_archived)
      .sort((a, b) => {
        const byDate = b.job_date.localeCompare(a.job_date);
        return byDate !== 0 ? byDate : b.created_at.localeCompare(a.created_at);
      });
  });

  // undefined = useLiveQuery hasn't resolved yet (also the SSR/first-paint
  // value, since Dexie isn't available server-side). Treat as "nothing yet"
  // → the zero-state, same calm surface as service-sheets-to-fill.
  const list = drafts ?? [];

  if (list.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-gray-500">Drafts to upgrade</h3>
        <p className="mt-3 text-sm text-gray-400">
          Nothing waiting — no drafts to upgrade.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">Drafts to upgrade</h3>
        <span className="text-xs text-gray-400">{list.length}</span>
      </div>
      <ul className="space-y-1.5">
        {list.slice(0, 5).map((d) => (
          <li key={d.id}>
            <Link
              href={`${ROUTES.jobDetail(d.id)}/upgrade`}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {d.capture_note || "(no description)"}
              </span>
              <ChevronRight />
            </Link>
          </li>
        ))}
        {list.length > 5 && (
          <li className="pt-1 text-center">
            <Link
              href={`${ROUTES.JOBS}?status=draft`}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              View all {list.length}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

function ChevronRight() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-gray-300"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}
