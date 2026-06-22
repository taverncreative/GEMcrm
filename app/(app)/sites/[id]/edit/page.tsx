"use client";

import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { db } from "@/lib/db";
import { ROUTES } from "@/lib/constants/routes";
import { EditSiteForm } from "@/components/sites/edit-site-form";
import type { Site } from "@/types/database";

/**
 * Edit a site. Client + Dexie-backed prefill (the synced local row), so it
 * works the same online or off; the SAVE is online-only (see EditSiteForm).
 * Lives at /sites/[id]/edit, a sibling of the read-only /sites/[id] detail.
 *
 * useLiveQuery returns `undefined` while in flight and `null` once we've
 * confirmed the row is missing or soft-deleted, so the two are
 * distinguishable.
 */
export default function EditSitePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";

  const site = useLiveQuery<Site | null>(
    async () => {
      if (!id) return null;
      const s = await db.sites.get(id);
      return s && !s.deleted_at ? s : null;
    },
    [id]
  );

  if (site === undefined) {
    return (
      <div className="max-w-lg">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (site === null) {
    return (
      <div className="max-w-lg">
        <h1 className="text-2xl font-semibold text-gray-900">Site not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          This site may have been deleted, or your local data hasn&rsquo;t
          synced yet.
        </p>
        <Link
          href={ROUTES.CUSTOMERS}
          className="mt-4 inline-block rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Edit site</h1>
      <div className="mt-6 max-w-lg rounded-xl bg-white p-6 shadow-sm">
        <EditSiteForm site={site} />
      </div>
    </div>
  );
}
