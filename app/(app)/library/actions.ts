"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  getLibraryDocumentById,
  softDeleteLibraryDocument,
} from "@/lib/data/library-documents";
import {
  createPrintOrder,
  markPrintOrderDelivered,
} from "@/lib/data/print-orders";
import { createFeatureRequest } from "@/lib/data/feature-requests";
import { sendEmail, sendLibraryDocument } from "@/lib/services/email";
import {
  sendFeedbackToSpotlight,
  sendPrintOrderToSpotlight,
} from "@/lib/services/spotlight";
import { validateRecipients } from "@/lib/validation/recipients";
import { PrintOrderSchema } from "@/lib/validation/print-order";
import { BUSINESS } from "@/lib/constants/branding";
import type { PrintOrderItem } from "@/types/database";

/**
 * Soft-delete a library document (single operator — Nate can remove an
 * outdated document; it is recoverable). Direct-call action from a button.
 * No revalidatePath (a broad revalidate purges the whole client router
 * cache); the caller runs router.refresh() so only the library page
 * re-renders.
 */
export async function softDeleteLibraryDocumentAction(
  id: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!id) return { success: false, message: "Missing document id" };
  try {
    await softDeleteLibraryDocument(id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to remove document",
    };
  }
}

/**
 * Email one library document as an attachment to one or more recipients.
 * Reuses the generic multi-recipient validation and the attachment-capable
 * send helper. The document's stored file is fetched server-side by path.
 */
export async function emailLibraryDocumentAction(
  id: string,
  recipients: string[]
): Promise<{ success: boolean; message?: string; emailedTo?: string }> {
  await requireUser();
  if (!id) return { success: false, message: "Missing document id" };

  const validated = validateRecipients(recipients ?? []);
  if (!validated.ok) return { success: false, message: validated.error };

  const doc = await getLibraryDocumentById(id);
  if (!doc) return { success: false, message: "Document not found" };

  const res = await sendLibraryDocument(
    validated.emails,
    doc.file_path,
    doc.file_name,
    doc.label
  );
  if (!res.success) {
    return { success: false, message: "Email failed to send. Try again." };
  }
  return { success: true, emailedTo: validated.emails.join(", ") };
}

/**
 * Ask John to change a library document ("Request edit").
 *
 * Rides the FEEDBACK plumbing, not a new contract: feature_requests row →
 * developer inbox email → fire-and-forget Spotlight POST via
 * sendFeedbackToSpotlight. That endpoint is the one we know exists and
 * answers with a real ACK; /api/inbound/print-order was never built, which
 * is exactly why nothing new gets invented here.
 *
 * The message carries the document's LABEL and its stable ID, so John can
 * identify the document even after a rename and even if the request arrives
 * out of context. The row id is Spotlight's idempotency key, as with any
 * other feature request.
 */
export async function requestDocumentEditAction(
  documentId: string,
  note?: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!documentId) return { success: false, message: "Missing document id" };

  const doc = await getLibraryDocumentById(documentId);
  if (!doc) return { success: false, message: "Document not found" };

  const trimmedNote = (note ?? "").trim();
  const message = [
    `Edit requested for site-folder document "${doc.label}".`,
    `Document ID: ${doc.id}`,
    `File: ${doc.file_name}`,
    ...(trimmedNote ? ["", `What needs changing: ${trimmedNote}`] : []),
  ].join("\n");

  let requestId: string;
  try {
    // The row is the local record AND the idempotency key.
    const created = await createFeatureRequest({
      request_type: "change",
      message,
    });
    requestId = created.id;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to log the request",
    };
  }

  // Backstop inbox copy — the thing that would have caught the print-order
  // endpoint being missing, so it is not optional here.
  await sendEmail({
    to: BUSINESS.supportEmail,
    subject: `[${BUSINESS.name} CRM] edit request: ${doc.label}`,
    text: message,
  });

  after(async () => {
    try {
      await sendFeedbackToSpotlight({
        message,
        request_id: requestId,
        type: "change",
        client_name: BUSINESS.signoffName,
      });
    } catch (spotlightErr) {
      console.error("[requestDocumentEditAction] spotlight:", spotlightErr);
    }
  });

  return { success: true, message: "Edit request sent." };
}

/**
 * Confirm a print basket. Mirrors the feedback submit's fire-and-forget
 * shape exactly:
 *   1. write the print_orders row FIRST (delivered=false) — the record and
 *      the idempotency-key home;
 *   2. return success to Nate IMMEDIATELY;
 *   3. POST to Spotlight inside after() (after the response is sent) and
 *      record the outcome — a Spotlight outage NEVER fails the confirmation.
 *
 * `orderId` is client-generated and is used as BOTH the row id and
 * Spotlight's order_id, so a retry with the same id is idempotent end to
 * end. No revalidatePath (router-cache stampede).
 */
export async function submitPrintOrderAction(input: {
  orderId: string;
  items: PrintOrderItem[];
  note?: string;
}): Promise<{ success: boolean; message?: string }> {
  await requireUser();

  const parsed = PrintOrderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid order",
    };
  }
  const { orderId, items, note } = parsed.data;

  try {
    await createPrintOrder({
      id: orderId,
      items,
      submitter: BUSINESS.signoffName,
      note: note ?? null,
    });
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to record order",
    };
  }

  after(async () => {
    try {
      const result = await sendPrintOrderToSpotlight({
        order_id: orderId,
        items,
        submitter: BUSINESS.signoffName,
        ordered_at: new Date().toISOString(),
        ...(note ? { note } : {}),
      });
      await markPrintOrderDelivered(orderId, result.delivered, result.reason);
    } catch (spotlightErr) {
      console.error("[submitPrintOrderAction] spotlight:", spotlightErr);
    }
  });

  return { success: true, message: "Order sent to print." };
}
