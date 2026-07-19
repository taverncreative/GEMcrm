"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { QuoteInputSchema } from "@/lib/validation/quote";
import { computeQuoteTotals } from "@/lib/quotes/money";
import { createQuote } from "@/lib/data/quotes";
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
 * from the line items (client math is never trusted). The PDF is NOT generated
 * here — that would block the response on a slow Puppeteer render; it is built
 * lazily on first download via /api/pdf/quote/[id], so create returns as soon
 * as the row is saved (quote_pdf_url stays null until then). On success it
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
    // No PDF render here — it is generated lazily on first download
    // (/api/pdf/quote/[id]) so create stays fast.
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
