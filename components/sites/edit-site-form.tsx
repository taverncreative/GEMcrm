"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateSiteAction } from "@/app/(app)/sites/[id]/actions";
import { SiteFormFields } from "@/components/sites/site-form-fields";
import { db } from "@/lib/db";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { ROUTES } from "@/lib/constants/routes";
import { safeInternalPath } from "@/lib/utils/safe-return-to";
import type { Site } from "@/types/database";

/**
 * Edit Site form.
 *
 * ONLINE ONLY (mirrors the customer edit + delete pattern): edit calls
 * `updateSiteAction` directly and is gated on connectivity. The
 * presentational field-set is shared with the create form via
 * {@link SiteFormFields}, pre-filled from the existing site.
 *
 * On success the server returns the canonical updated row, which we write
 * straight into Dexie so the Dexie-backed surfaces (the customer side
 * panel's site rows, a job's complete page) reflect the new address
 * immediately rather than wait for the next sync pull; the server-rendered
 * site detail page is refreshed by the action's revalidatePath. Then we
 * navigate back to the site.
 */
export function EditSiteForm({
  site,
  returnTo,
}: {
  site: Site;
  /** Optional internal path to land on after save/cancel (validated) — e.g.
   *  the service-sheet gate sends the operator back to /jobs/[id]/complete.
   *  Defaults to the site detail page. */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const online = useIsOnline();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const back = ROUTES.siteDetail(site.id);
  // Honour a whitelisted returnTo, else the default site-detail destination.
  const dest = safeInternalPath(returnTo) ?? back;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    setServerError(null);
    setSaving(true);

    const result = await updateSiteAction(site.id, fd);
    if (result.success && result.site) {
      // Refresh the local cache so the new address is visible at once.
      await db.sites.put(result.site);
      router.push(dest);
      return;
    }

    setErrors(result.errors ?? {});
    setServerError(result.message);
    setSaving(false);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <SiteFormFields errors={errors} defaults={site} />

      {serverError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {serverError}
        </div>
      )}

      {!online && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You&rsquo;re offline — editing a site needs a connection. Your
          changes aren&rsquo;t saved until you&rsquo;re back online.
        </p>
      )}

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Link
          href={dest}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving || !online}
          title={online ? undefined : "Online required"}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
