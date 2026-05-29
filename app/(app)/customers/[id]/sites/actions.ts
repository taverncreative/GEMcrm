"use server";

import { redirect } from "next/navigation";
import { SiteSchema } from "@/lib/validation/site";
import { createSite } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

export async function createSiteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const customerId = formData.get("customer_id") as string;

  if (!customerId) {
    return { success: false, errors: {}, message: "Missing customer ID" };
  }

  const customer = await getCustomerById(customerId);
  if (!customer) {
    return { success: false, errors: {}, message: "Customer not found" };
  }

  // Defensive: formData.get() returns null when a field is missing
  // (e.g. an "Address Line 2" left blank that React omitted from the
  // form). Zod's `optionalString = z.string().optional().default("")`
  // accepts undefined but REJECTS null — silent action failure that
  // takes rounds to diagnose. Coerce null → "" before Zod sees it.
  // Mirrors createCustomerAction + completeServiceSheetAction.
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
      if (typeof key === "string") {
        errors[key] = issue.message;
      }
    }
    return { success: false, errors, message: null };
  }

  try {
    await createSite(customerId, result.data);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create site",
    };
  }

  redirect(ROUTES.customerDetail(customerId));
}
