"use server";

import { revalidatePath } from "next/cache";
import {
  setGoogleReviewReceived,
} from "@/lib/data/customers";
import { snoozeReviewRequest } from "@/lib/data/reviews";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";

/**
 * Snooze the review prompt for ~7 days. The customer reappears in the
 * dashboard widget after that.
 */
export async function snoozeReviewAction(
  customerId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!customerId) return { success: false, message: "Missing id" };
  try {
    await snoozeReviewRequest(customerId, 7);
    revalidatePath(ROUTES.DASHBOARD);
    revalidatePath(ROUTES.CUSTOMERS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to snooze",
    };
  }
}

/**
 * Mark "already left a review" or "never ask" — both flip the
 * google_review_received flag so the customer disappears from the widget
 * and the table checkbox shows ticked.
 */
export async function markReviewReceivedAction(
  customerId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!customerId) return { success: false, message: "Missing id" };
  try {
    await setGoogleReviewReceived(customerId, true);
    revalidatePath(ROUTES.DASHBOARD);
    revalidatePath(ROUTES.CUSTOMERS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to update",
    };
  }
}
