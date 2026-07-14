"use server";

import { revalidatePath } from "next/cache";
import { updateAgreementStatus, getAgreementById } from "@/lib/data/agreements";
import { getCustomerById } from "@/lib/data/customers";
import { sendAgreement } from "@/lib/services/email";
import { validateRecipients } from "@/lib/validation/recipients";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { AgreementStatus } from "@/types/database";

const VALID: AgreementStatus[] = ["active", "paused", "cancelled"];

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
  if (!VALID.includes(status as AgreementStatus)) {
    return { success: false, errors: {}, message: "Invalid status" };
  }

  try {
    await updateAgreementStatus(id, status as AgreementStatus);
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
