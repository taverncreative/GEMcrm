"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { QuoteInputSchema } from "@/lib/validation/quote";
import { computeQuoteTotals } from "@/lib/quotes/money";
import { createQuote, softDeleteQuote } from "@/lib/data/quotes";
import { renderAndStoreQuotePdf } from "@/lib/services/quote-pdf";
import { ROUTES } from "@/lib/constants/routes";
import type { ActionState } from "@/types/actions";

function emptyToNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Create a quote (Slice 1). Online-only, mirrors the agreement-create posture:
 * requireUser -> Zod validate -> direct insert (no Dexie/outbox). The DB
 * trigger assigns the Q-YYYY-NNN number; totals are RE-COMPUTED server-side
 * from the line items (client math is never trusted). The PDF is NOT rendered
 * inline — that would block the response on a slow Puppeteer render; instead
 * after() pre-warms it in the background once the response is sent, and the
 * on-demand /api/pdf/quote/[id] route regenerates on first hit if the pre-warm
 * hasn't landed. So create returns as soon as the row is saved. On success it
 * redirects to the new quote's detail page (a forward navigation, so the
 * /quotes list and Documents refetch fresh — no revalidatePath, no stampede).
 */
export async function createQuoteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();

  // Line items arrive as a single serialised JSON field from the dynamic form.
  let parsedLineItems: unknown = [];
  const rawLineItems = (formData.get("line_items") as string) ?? "[]";
  try {
    parsedLineItems = JSON.parse(rawLineItems);
  } catch {
    return {
      success: false,
      errors: { line_items: "Could not read the line items" },
      message: null,
    };
  }

  const raw = {
    customer_id: (formData.get("customer_id") as string) ?? "",
    customer_name: (formData.get("customer_name") as string) ?? "",
    customer_address: (formData.get("customer_address") as string) ?? "",
    customer_email: (formData.get("customer_email") as string) ?? "",
    line_items: parsedLineItems,
    vat_registered: formData.get("vat_registered") === "on",
    vat_rate: (formData.get("vat_rate") as string) ?? "20",
    terms: (formData.get("terms") as string) ?? "",
    valid_until: (formData.get("valid_until") as string) ?? "",
    notes: (formData.get("notes") as string) ?? "",
  };

  const parsed = QuoteInputSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in errors)) {
        errors[key] = issue.message;
      }
    }
    return { success: false, errors, message: null };
  }

  const data = parsed.data;

  // Authoritative server-side money maths (pennies internally, 2dp stored).
  const totals = computeQuoteTotals(
    data.line_items,
    data.vat_registered,
    data.vat_rate
  );

  let quoteId: string;
  try {
    const quote = await createQuote({
      customer_id: emptyToNull(data.customer_id),
      customer_name: data.customer_name.trim(),
      customer_address: emptyToNull(data.customer_address),
      customer_email: emptyToNull(data.customer_email),
      line_items: totals.lineItems,
      subtotal: totals.subtotal,
      vat_registered: data.vat_registered,
      vat_rate: data.vat_rate,
      vat_amount: totals.vat_amount,
      total: totals.total,
      terms: emptyToNull(data.terms),
      valid_until: emptyToNull(data.valid_until),
      notes: emptyToNull(data.notes),
      created_by: user.id,
    });
    quoteId = quote.id;
    // Create stays fast: the PDF is NOT rendered inline. after() runs the
    // render AFTER the response is sent, so the row saves and redirects
    // immediately while the PDF pre-warms in the background — by the time the
    // user clicks Download it is usually already cached. Best-effort: a failure
    // just leaves quote_pdf_url null, and the on-demand /api/pdf/quote/[id]
    // route regenerates on first hit, so the download can never be lost.
    const idForWarm = quoteId;
    after(async () => {
      try {
        await renderAndStoreQuotePdf(idForWarm);
      } catch (err) {
        console.error("[createQuoteAction] PDF pre-warm:", err);
      }
    });
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create quote",
    };
  }

  // Forward navigation refetches the list + Documents fresh (no revalidatePath).
  redirect(ROUTES.quoteDetail(quoteId));
}

/**
 * Delete a quote (soft-delete via the soft_delete_quote RPC). Online-only and
 * requireUser-gated, mirroring the agreement discard action. No revalidatePath:
 * the caller does a scoped router.refresh() on success, so the list refetches
 * without purging the whole client router cache (avoids the prefetch stampede).
 */
export async function deleteQuoteAction(
  quoteId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!quoteId) return { success: false, message: "Missing quote ID" };

  try {
    await softDeleteQuote(quoteId);
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to delete quote",
    };
  }

  return { success: true };
}
