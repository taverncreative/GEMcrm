"use server";

import { requireUser } from "@/lib/auth/require-user";
import {
  getDocumentForEmail,
  type DocumentForEmail,
  type DocumentKind,
} from "@/lib/data/documents";
import { downloadReportPdf, sendDocumentAttachment } from "@/lib/services/email";
import { renderAndStoreQuotePdf } from "@/lib/services/quote-pdf";
import { markQuoteSent } from "@/lib/data/quotes";
import { validateRecipients } from "@/lib/validation/recipients";
import { softDeleteReport } from "@/lib/data/reports";

/**
 * Soft-delete a service sheet from the Documents list.
 *
 * The ONLY delete path for a report, and deliberately a soft one: the sheet
 * is the record of work performed, so the row is stamped `deleted_at` and
 * the stored PDF is left untouched in the `reports` bucket — consistent with
 * every other delete in the app. There is no hard-delete counterpart (see
 * {@link softDeleteReport} and migration 039).
 *
 * Online-only, like the sibling row actions.
 */
export async function deleteReportAction(
  reportId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!reportId) return { success: false, message: "Missing report id" };
  try {
    await softDeleteReport(reportId);
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to delete service sheet",
    };
  }
  // No revalidatePath — it purges the WHOLE client router cache and triggers
  // a prefetch stampede in prod (the same reason deleteJobAction skips it).
  // The caller drops the row optimistically and calls router.refresh().
  return { success: true };
}

/**
 * Load a document's PDF bytes, GENERATING them when there is nothing stored.
 *
 * A quote's PDF is rendered lazily — `quote_pdf_url` stays null until someone
 * downloads it. Emailing one must not fail just because nobody happened to
 * open it first, so we render (and cache, via the same service the download
 * route uses) and attach the fresh bytes. The same path covers a STALE stored
 * URL, where the row points at an object that is no longer there.
 *
 * Service sheets and agreements are rendered and stored at completion/signing
 * and the Documents list only lists rows whose PDF column is non-null, so
 * there is nothing to generate for them: if their stored object can't be
 * downloaded, that's a storage fault and the caller reports it rather than
 * silently sending an email with no document on it.
 */
async function loadDocumentPdf(doc: DocumentForEmail): Promise<Buffer | null> {
  if (doc.pdfUrl) {
    const stored = await downloadReportPdf(doc.pdfUrl);
    if (stored) return stored;
  }
  if (doc.kind === "quote") {
    const rendered = await renderAndStoreQuotePdf(doc.id);
    return rendered?.buffer ?? null;
  }
  return null;
}

/**
 * Email any stored document from the Documents list — service sheet,
 * agreement or quote — to one or more addresses, after the fact.
 *
 * Reuses the generic pieces rather than the report-specific sender: shared
 * multi-recipient validation (any invalid address HARD-BLOCKS the whole send)
 * and `sendDocumentAttachment`, whose subject and body name whatever document
 * was attached. Online-only, like the sibling row actions.
 */
export async function emailDocumentAction(
  kind: DocumentKind,
  id: string,
  recipients: string[]
): Promise<{ success: boolean; message?: string; emailedTo?: string; label?: string }> {
  await requireUser();
  if (!id) return { success: false, message: "Missing document id" };

  const validated = validateRecipients(recipients ?? []);
  if (!validated.ok) return { success: false, message: validated.error };

  const doc = await getDocumentForEmail(kind, id);
  if (!doc) return { success: false, message: "Document not found" };

  let pdf: Buffer | null;
  try {
    pdf = await loadDocumentPdf(doc);
  } catch (err) {
    console.error("[emailDocumentAction] pdf:", err);
    return {
      success: false,
      message: "Could not prepare the document PDF. Try again.",
    };
  }
  if (!pdf) {
    return {
      success: false,
      message: "Could not load the document to attach. Try opening it first.",
    };
  }

  const res = await sendDocumentAttachment(
    validated.emails,
    pdf,
    doc.fileName,
    doc.label
  );
  if (!res.success) {
    return { success: false, message: "Email failed to send. Try again." };
  }

  // A quote is 'draft' until it actually goes out. Marking HERE, past the
  // success check and inside the single send action, means every entry point
  // (the quote detail page, the Documents list) marks it, and a failed send
  // never does. Best-effort: the email is already delivered, so a status
  // write that fails must not report the send as failed — it would invite a
  // duplicate send to the customer.
  if (kind === "quote") {
    try {
      await markQuoteSent(id);
    } catch (err) {
      console.error("[emailDocumentAction] markQuoteSent:", err);
    }
  }

  return {
    success: true,
    emailedTo: validated.emails.join(", "),
    label: doc.label,
  };
}
