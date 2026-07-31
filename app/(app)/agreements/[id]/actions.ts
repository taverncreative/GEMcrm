"use server";

import { revalidatePath } from "next/cache";
import {
  updateAgreementStatus,
  getAgreementById,
  getAgreementWithContext,
  softDeleteAgreement,
} from "@/lib/data/agreements";
import { getCustomerById } from "@/lib/data/customers";
import { sendAgreement, sendAgreementReview } from "@/lib/services/email";
import { generateAgreementPdf } from "@/lib/pdf/generate-agreement-pdf";
import { generateAgreementJobs } from "@/lib/services/agreement-events";
import { uploadPdf, uploadBase64Image } from "@/lib/storage/upload";
import { createClient } from "@/lib/supabase/server";
import { validateRecipients } from "@/lib/validation/recipients";
import { FinaliseAgreementSchema } from "@/lib/validation/agreement";
import { todayUk } from "@/lib/utils/today-uk";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { Agreement } from "@/types/database";

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

  // A DRAFT can never be status-flipped (the UI hides these buttons for
  // drafts, but this action is also outbox-replayable, so guard the
  // CURRENT status server-side too): activating without signatures would
  // sidestep the finalise flow entirely.
  const current = await getAgreementById(id);
  if (!current) {
    return { success: false, errors: {}, message: "Agreement not found" };
  }
  if (current.status === "draft") {
    return {
      success: false,
      errors: {},
      message:
        "A draft is finalised by capturing signatures, not by changing status.",
    };
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
    validated.emails,
    agreement.reference_number ?? undefined
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
      validated.emails,
      agreement.reference_number ?? undefined
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

/**
 * FINALISE a draft agreement (Slice 2): capture both signatures on the
 * visit, flip it active, and only then generate the scheduled visits and
 * the signed contract PDF.
 *
 * Order matters:
 *   1. validate + upload signatures + update the row (active, signed_date)
 *   2. generateAgreementJobs — visits exist only from this moment (a draft
 *      never had any); idempotent + status-gated, so a replay or a repeat
 *      call cannot double-generate
 *   3. regenerate the SIGNED PDF over agreements/<id>/contract.pdf and point
 *      contract_pdf_url at it (replacing the watermarked review.pdf URL, so
 *      the agreement now surfaces in Documents as a signed contract)
 *   4. auto-send the signed copy to the customer email, exactly like the
 *      sign-now create path (skip silently if no email on file)
 *
 * Steps 3-4 are best-effort like the create path: a Puppeteer or email
 * failure never rolls back an agreement that is now signed and active.
 * Online-only. Rejects anything that is not currently a draft, so a second
 * finalise attempt fails cleanly.
 */
export async function finaliseDraftAgreementAction(
  agreementId: string,
  input: {
    client_signature: string;
    gem_signature: string;
    client_signatory_name: string;
    signed_date?: string;
  }
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!agreementId) return { success: false, message: "Missing agreement ID" };

  const parsed = FinaliseAgreementSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { success: false, message: first?.message ?? "Invalid signatures" };
  }

  const agreement = await getAgreementWithContext(agreementId);
  if (!agreement) return { success: false, message: "Agreement not found" };
  if (agreement.status !== "draft") {
    return {
      success: false,
      message: "Only a draft agreement can be finalised.",
    };
  }

  let updated: Agreement;
  try {
    // Signatures land in the same storage slots the sign-now path uses.
    const clientSigUrl = await uploadBase64Image(
      parsed.data.client_signature,
      `agreements/${agreementId}/client.png`
    );
    const gemSigUrl = await uploadBase64Image(
      parsed.data.gem_signature,
      `agreements/${agreementId}/gem.png`
    );

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("agreements")
      .update({
        client_signature_url: clientSigUrl,
        gem_signature_url: gemSigUrl,
        client_signatory_name: parsed.data.client_signatory_name.trim(),
        signed_date: parsed.data.signed_date?.trim() || todayUk(),
        status: "active",
      })
      .eq("id", agreementId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    updated = data as Agreement;
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to finalise agreement",
    };
  }

  // Visits: generated NOW, from the agreement's start_date via the
  // even-year-spread (agreementVisitDates). Self-guarded: active-only +
  // skips if any jobs already exist for this agreement.
  await generateAgreementJobs(updated);

  // Signed PDF + auto-send — best-effort, mirroring createAgreementAction.
  try {
    const pdfBuffer = await generateAgreementPdf({
      agreement: updated,
      customer: agreement.customer,
      site: agreement.site,
      mode: "signed",
    });
    const pdfUrl = await uploadPdf(
      pdfBuffer,
      `agreements/${agreementId}/contract.pdf`
    );
    const supabase = await createClient();
    await supabase
      .from("agreements")
      .update({ contract_pdf_url: pdfUrl })
      .eq("id", agreementId);

    if (agreement.customer.email) {
      await sendAgreement(
        agreement.customer,
        pdfUrl,
        undefined,
        agreement.reference_number ?? undefined
      );
    }
  } catch (pdfErr) {
    console.error(
      "[finaliseDraftAgreementAction] PDF generate/send failed:",
      pdfErr
    );
  }

  revalidatePath(`${ROUTES.AGREEMENTS}/${agreementId}`);
  revalidatePath(ROUTES.AGREEMENTS);
  revalidatePath(ROUTES.siteDetail(updated.site_id));
  revalidatePath(ROUTES.customerDetail(updated.customer_id));
  revalidatePath(ROUTES.DASHBOARD);
  return { success: true };
}

/**
 * Statuses an agreement can be deleted from.
 *
 *   draft     — never became a contract at all (the "Discard draft" flow).
 *   cancelled — was a contract and is now dead. Nothing is protected by
 *               keeping the row; a cancelled test or duplicate contract
 *               would otherwise sit in the list forever.
 *
 * ACTIVE and PAUSED are deliberately absent and must stay that way: those
 * are live customer contracts. A paused agreement is a live one on hold,
 * not a dead one. To delete either, cancel it first — which is a visible,
 * deliberate act with its own button.
 */
const DELETABLE_STATUSES = ["draft", "cancelled"] as const;

/**
 * Soft-delete an agreement (deleted_at). Allowed from `draft` and
 * `cancelled` only — see {@link DELETABLE_STATUSES}. The write goes through
 * softDeleteAgreement → the `soft_delete_agreement` SECURITY DEFINER RPC
 * (043). RLS + the explicit deleted_at filters keep a deleted agreement out
 * of every list.
 *
 * The agreement's generated visits are NOT touched — soft delete never
 * cascades, and no jobs read joins through agreements, so any visit still
 * sitting on the calendar stays there. In practice a cancelled agreement's
 * future visits are already lingering (cancelling only flips the status),
 * so deleting the agreement neither creates nor clears that; the confirm
 * dialog names the count rather than pretending otherwise.
 *
 * No revalidatePath — the callers run a scoped router.refresh() after
 * navigating, which re-renders the server-rendered agreements list without
 * purging the whole client router cache.
 */
export async function deleteAgreementAction(
  agreementId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!agreementId) return { success: false, message: "Missing agreement ID" };

  const agreement = await getAgreementById(agreementId);
  if (!agreement) return { success: false, message: "Agreement not found" };
  if (
    !DELETABLE_STATUSES.includes(
      agreement.status as (typeof DELETABLE_STATUSES)[number]
    )
  ) {
    return {
      success: false,
      message:
        "This is a live agreement. Cancel it first, then it can be deleted.",
    };
  }

  try {
    await softDeleteAgreement(agreementId);
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to delete agreement",
    };
  }

  return { success: true };
}

/**
 * Count of visits generated by this agreement that are still scheduled or
 * in progress — surfaced in the delete confirm so the operator knows they
 * will remain on the calendar afterwards.
 */
export async function getAgreementDeleteImpactAction(
  agreementId: string
): Promise<{ remainingVisits: number }> {
  await requireUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", agreementId)
    .in("job_status", ["scheduled", "in_progress"])
    .eq("is_archived", false);

  return { remainingVisits: count ?? 0 };
}
