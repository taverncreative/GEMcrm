"use server";

import { revalidatePath } from "next/cache";
import { SiteSchema } from "@/lib/validation/site";
import {
  updateSite,
  deleteSite,
  getSiteDeleteImpact,
  type SiteDeleteImpact,
} from "@/lib/data/sites";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { Site } from "@/types/database";

/**
 * Edit an existing site. Online-only direct action (mirrors
 * updateCustomerAction) — same SiteSchema validation as createSiteAction,
 * reused verbatim. Returns the updated row so the client can refresh its
 * local (Dexie) cache immediately rather than wait for the next sync pull.
 */
export async function updateSiteAction(
  siteId: string,
  formData: FormData
): Promise<ActionState & { site?: Site }> {
  await requireUser();
  if (!siteId) {
    return { success: false, errors: {}, message: "Missing site id" };
  }

  // Coerce null → "" before Zod (same defensive normalisation as
  // createSiteAction): a field React omitted arrives as null, which Zod's
  // optional strings reject.
  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const raw = {
    address_line_1: str("address_line_1"),
    address_line_2: str("address_line_2"),
    town: str("town"),
    county: str("county"),
    postcode: str("postcode"),
  };

  const result = SiteSchema.safeParse(raw);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  let site: Site;
  try {
    site = await updateSite(siteId, result.data);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to update site",
    };
  }

  // The site detail page is server-rendered (getSiteById); refresh it and
  // the customer surfaces that show the site address.
  revalidatePath(ROUTES.siteDetail(siteId));
  revalidatePath(ROUTES.customerDetail(site.customer_id));
  revalidatePath(ROUTES.CUSTOMERS);
  return { success: true, errors: {}, message: null, site };
}

/**
 * Impact preview for the delete-site confirm dialog — the jobs, service
 * sheets and agreements attached to this site.
 */
export async function getSiteDeleteImpactAction(
  siteId: string
): Promise<SiteDeleteImpact> {
  await requireUser();
  return getSiteDeleteImpact(siteId);
}

/**
 * Soft-delete a site and everything that only made sense underneath it —
 * its jobs and its draft/cancelled agreements (see {@link deleteSite}).
 * Online-only, `requireUser` gated, mirroring the customer and job deletes.
 *
 * BLOCKED when the site has an active or paused agreement: that is a live
 * contract, and the operator has to cancel it deliberately first. The check
 * is made here so the message is a sentence rather than a raw Postgres
 * error, and again inside the RPC so a stale dialog cannot slip past it.
 *
 * No revalidatePath — the confirm dialog mirrors the soft-delete into Dexie
 * and the caller runs a scoped router.refresh(), so the client router cache
 * is never purged (prefetch stampede).
 */
export async function deleteSiteAction(
  siteId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!siteId) return { success: false, message: "Missing site id" };

  try {
    const impact = await getSiteDeleteImpact(siteId);
    if (impact.liveAgreements > 0) {
      return {
        success: false,
        message:
          impact.liveAgreements === 1
            ? "This site has a live agreement. Cancel the agreement first, then delete the site."
            : `This site has ${impact.liveAgreements} live agreements. Cancel them first, then delete the site.`,
      };
    }
    await deleteSite(siteId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to delete site",
    };
  }
}
