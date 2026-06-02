"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CustomerSchema } from "@/lib/validation/customer";
import {
  createCustomer,
  setGoogleReviewReceived,
  updateCustomerType,
  getCustomerDetail,
  deleteCustomer,
  getDeleteImpact,
} from "@/lib/data/customers";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { CustomerDetail, DeleteImpact } from "@/lib/data/customers";
import type { CustomerType } from "@/types/database";

export async function createCustomerAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();

  // Normalise missing fields to "" rather than null. When the operator
  // picks "Domestic", the form hides company_name / position / website,
  // so formData.get() returns null for those. The Zod schema's optional
  // string fields accept undefined but not null, so passing null caused
  // a silent validation failure on fields that weren't even visible —
  // i.e. the form appeared to do nothing on submit.
  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const raw = {
    name: str("name"),
    company_name: str("company_name"),
    position: str("position"),
    email: str("email"),
    phone: str("phone"),
    mobile: str("mobile"),
    address_line_1: str("address_line_1"),
    address_line_2: str("address_line_2"),
    town: str("town"),
    county: str("county"),
    postcode: str("postcode"),
    website: str("website"),
    notes: str("notes"),
    annual_contract_value: str("annual_contract_value"),
    customer_type: str("customer_type") || "commercial",
  };

  const result = CustomerSchema.safeParse(raw);

  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        errors[key] = issue.message;
      }
    }
    // Diagnostic log — surfaces in Vercel runtime logs. Helps us see
    // exactly which field rejected when a form submit silently fails
    // (e.g. a hidden field on the inactive customer-type tab).
    console.error(
      "[createCustomerAction] validation failed",
      JSON.stringify({
        customer_type: raw.customer_type,
        errors,
        issues: result.error.issues.map((i) => ({
          path: i.path,
          code: i.code,
          message: i.message,
        })),
      })
    );
    return {
      success: false,
      errors,
      message: "Please check the form for errors.",
    };
  }

  // Parse + sanity-check any additional service locations submitted by
  // the form (commercial customers can add multiple). Each entry uses
  // the same five address fields; we keep only the ones with enough
  // address to be a useful site (line 1 + town + postcode at minimum).
  const additionalSites: Array<{
    address_line_1: string;
    address_line_2: string;
    town: string;
    county: string;
    postcode: string;
  }> = [];

  const additionalSitesRaw = str("additional_sites");
  if (additionalSitesRaw) {
    try {
      const parsed: unknown = JSON.parse(additionalSitesRaw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry === "object") {
            const e = entry as Record<string, unknown>;
            const site = {
              address_line_1: typeof e.address_line_1 === "string" ? e.address_line_1 : "",
              address_line_2: typeof e.address_line_2 === "string" ? e.address_line_2 : "",
              town: typeof e.town === "string" ? e.town : "",
              county: typeof e.county === "string" ? e.county : "",
              postcode: typeof e.postcode === "string" ? e.postcode : "",
            };
            // Skip silently if address is too sparse to be useful — the
            // operator may have clicked "Add location" but not filled it in.
            if (site.address_line_1.trim() && site.town.trim() && site.postcode.trim()) {
              additionalSites.push(site);
            }
          }
        }
      }
    } catch {
      // Malformed JSON — ignore, save customer without extras.
      console.error("[createCustomerAction] additional_sites JSON parse failed");
    }
  }

  try {
    await createCustomer(result.data, additionalSites);
  } catch (err) {
    console.error("[createCustomerAction] createCustomer threw:", err);
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create customer",
    };
  }

  // Invalidate the customers list cache so the new row appears
  // immediately after the redirect lands on /customers.
  revalidatePath(ROUTES.CUSTOMERS);
  redirect(ROUTES.CUSTOMERS);
}

// ─── Side-panel data fetch ───────────────────────────────────────────────

export async function getCustomerDetailAction(
  customerId: string
): Promise<CustomerDetail | null> {
  await requireUser();
  if (!customerId) return null;
  return getCustomerDetail(customerId);
}

/**
 * Online-only fetch for the side-panel's Documents section.
 *
 * The Surface-3 offline conversion moved customer/sites/jobs/agreements/
 * tasks reads to Dexie via useLiveQuery, but the `reports` table is
 * NOT synced (offline-pwa Gap A → Option A). Report PDF URLs live in
 * Supabase Storage and require an online round-trip to open anyway, so
 * caching the rows offline would just produce dead-on-tap entries.
 *
 * This action is called LAZILY from the side panel only when
 * `navigator.onLine` is true. Offline, the panel renders a
 * "Service report PDFs require an online connection" notice instead
 * and never invokes this action.
 *
 * Returns the same shape `getCustomerDetail` previously returned for
 * the `reports` field — minimised projection so we don't ship
 * unnecessary bytes back to the browser.
 */
export interface ServiceReportSummary {
  id: string;
  job_id: string;
  pdf_url: string | null;
  created_at: string;
}

export async function getServiceReportsForCustomerAction(
  customerId: string
): Promise<ServiceReportSummary[]> {
  await requireUser();
  if (!customerId) return [];
  const detail = await getCustomerDetail(customerId);
  // Reuse the existing reports query embedded in getCustomerDetail
  // rather than duplicate the join logic. Slight over-fetch (we throw
  // away the rest of the detail bundle) but the function is online-only
  // and rarely the bottleneck — keeping the join in one place avoids
  // drift when the underlying schema changes.
  return detail?.reports ?? [];
}

// ─── Inline toggles ──────────────────────────────────────────────────────

export async function setReviewReceivedAction(
  customerId: string,
  received: boolean
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!customerId) return { success: false, message: "Missing customer id" };
  try {
    await setGoogleReviewReceived(customerId, received);
    revalidatePath(ROUTES.CUSTOMERS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to update review status",
    };
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────

export async function getDeleteImpactAction(
  customerId: string
): Promise<DeleteImpact> {
  await requireUser();
  return getDeleteImpact(customerId);
}

export async function deleteCustomerAction(
  customerId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!customerId) return { success: false, message: "Missing customer id" };
  try {
    await deleteCustomer(customerId);
    revalidatePath(ROUTES.CUSTOMERS);
    revalidatePath(ROUTES.DASHBOARD);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to delete",
    };
  }
}

export async function setCustomerTypeAction(
  customerId: string,
  type: CustomerType
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!customerId) return { success: false, message: "Missing customer id" };
  if (type !== "commercial" && type !== "domestic") {
    return { success: false, message: "Invalid type" };
  }
  try {
    await updateCustomerType(customerId, type);
    revalidatePath(ROUTES.CUSTOMERS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to update type",
    };
  }
}
