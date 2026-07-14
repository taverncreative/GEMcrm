"use server";

import { revalidatePath } from "next/cache";
import {
  updateAgreementStatus,
  getAgreementById,
  getAgreementWithContext,
} from "@/lib/data/agreements";
import { getCustomerById } from "@/lib/data/customers";
import { sendAgreement, sendAgreementReview } from "@/lib/services/email";
import { generateAgreementPdf } from "@/lib/pdf/generate-agreement-pdf";
import { uploadPdf } from "@/lib/storage/upload";
import { createClient } from "@/lib/supabase/server";
import { validateRecipients } from "@/lib/validation/recipients";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

// Draft is deliberately excluded: a draft is FINALISED (signatures captured,
// Slice 2), not flipped via this status action.
const VALID = ["active", "paused", "cancelled"] as const;
type UpdatableStatus = (typeof VALID)[number];

export async function updateAgreementStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const id = formData.get("agreement_id") as string;
  const status = formData.get("status") as string;

  if (!id) {
    return { success: false, errors: {}, message: "Missing agreement ID" };
  }
  if (!VALID.includes(status as UpdatableStatus)) {
    return { success: false, errors: {}, message: "Invalid status" };
  }

  try {
    await updateAgreementStatus(id, status as UpdatableStatus);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to update status",
    };
  }

  revalidatePath(`${ROUTES.AGREEMENTS}/${id}`);
  revalidatePath(ROUTES.AGREEMENTS);
  revalidatePath(ROUTES.DASHBOARD);
  return { success: true, errors: {}, message: null };
}

/**
 * Send an agreement's contract PDF to one or more recipients (the
 * multi-recipient flow — all in a single Resend `to`). Online-only.
 * Recipients are validated server-side (hard-block on any invalid one).
 * Agreements have no "emailed to" column, so nothing is persisted; the
 * UI shows a transient result. Re-sending is always allowed.
 */
export async function sendAgreementNowAction(
  agreementId: string,
  recipients: string[]
): Promise<{ success: boolean; message?: string; emailedTo?: string }> {
  await requireUser();
  if (!agreementId) return { success: false, message: "Missing agreement ID" };

  const validated = validateRecipients(recipients ?? []);
  if (!validated.ok) {
    return { success: false, message: validated.error };
  }

  const agreement = await getAgreementById(agreementId);
  if (!agreement) return { success: false, message: "Agreement not found" };
  if (!agreement.contract_pdf_url) {
    return {
      success: false,
      message: "No agreement PDF yet, nothing to send.",
    };
  }

  const customer = await getCustomerById(agreement.customer_id);
  if (!customer) return { success: false, message: "Customer not found" };

  const sendRes = await sendAgreement(
    customer,
    agreement.contract_pdf_url,
    validated.emails
  );
  if (!sendRes.success) {
    return { success: false, message: "Email failed to send. Try again." };
  }

  return { success: true, emailedTo: validated.emails.join(", ") };
}

/**
 * Send the UNSIGNED review copy of a DRAFT agreement to one or more
 * recipients. Renders the watermarked review PDF on demand, stores it at
 * agreements/<id>/review.pdf (its URL in contract_pdf_url), and emails a
 * signed 7-day link with the review subject. Only valid for a draft;
 * re-runnable (a re-send regenerates the review PDF). Online-only.
 */
export async function sendAgreementReviewAction(
  agreementId: string,
  recipients: string[]
): Promise<{ success: boolean; message?: string; emailedTo?: string }> {
  await requireUser();
  if (!agreementId) return { success: false, message: "Missing agreement ID" };

  const validated = validateRecipients(recipients ?? []);
  if (!validated.ok) {
    return { success: false, message: validated.error };
  }

  const agreement = await getAgreementWithContext(agreementId);
  if (!agreement) return { success: false, message: "Agreement not found" };
  if (agreement.status !== "draft") {
    return {
      success: false,
      message: "Only a draft agreement can be sent for review.",
    };
  }

  try {
    const pdfBuffer = await generateAgreementPdf({
      agreement,
      customer: agreement.customer,
      site: agreement.site,
      mode: "review",
    });
    const pdfUrl = await uploadPdf(
      pdfBuffer,
      `agreements/${agreementId}/review.pdf`
    );

    const supabase = await createClient();
    await supabase
      .from("agreements")
      .update({ contract_pdf_url: pdfUrl })
      .eq("id", agreementId);

    const sendRes = await sendAgreementReview(
      agreement.customer,
      pdfUrl,
      validated.emails
    );
    if (!sendRes.success) {
      return { success: false, message: "Email failed to send. Try again." };
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to send review copy",
    };
  }

  revalidatePath(`${ROUTES.AGREEMENTS}/${agreementId}`);
  return { success: true, emailedTo: validated.emails.join(", ") };
}
