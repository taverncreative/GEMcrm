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
    // Always set a top-level message too — otherwise a validation error
    // on a hidden / not-yet-rendered field (e.g. the user is on the
    // domestic tab but a commercial-only field rejected) would leave
    // the user with no visible indication that anything went wrong.
    return {
      success: false,
      errors,
      message: "Please check the form for errors.",
    };
  }

  try {
    await createCustomer(result.data);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create customer",
    };
  }

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
