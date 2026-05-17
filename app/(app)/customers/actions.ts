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
  const raw = {
    name: formData.get("name") as string,
    company_name: formData.get("company_name") as string,
    position: formData.get("position") as string,
    email: formData.get("email") as string,
    phone: formData.get("phone") as string,
    mobile: formData.get("mobile") as string,
    address_line_1: formData.get("address_line_1") as string,
    address_line_2: formData.get("address_line_2") as string,
    town: formData.get("town") as string,
    county: formData.get("county") as string,
    postcode: formData.get("postcode") as string,
    website: formData.get("website") as string,
    notes: formData.get("notes") as string,
    annual_contract_value:
      (formData.get("annual_contract_value") as string) || "",
    customer_type: (formData.get("customer_type") as string) || "commercial",
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
    return { success: false, errors, message: null };
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
