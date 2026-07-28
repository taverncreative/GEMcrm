/**
 * Who a quote's email should go to, by default.
 *
 * A quote carries its OWN bill-to address (quotes.customer_email), captured
 * when it was written. That wins over the linked customer record for two
 * reasons: a prospect quote has no linked customer at all (customer_id is
 * null, so there is nothing to fall back to), and a quote for an existing
 * customer may be deliberately addressed elsewhere — a site manager, a
 * landlord, a different person in accounts.
 *
 * The customer record is the fallback for the case where a quote was written
 * without an address typed in. Empty string means "no default, let the
 * operator type one" — never a half-address.
 *
 * Shared by the Documents list and the quote detail page so both entry points
 * prefill the same address.
 */
export function quoteRecipientEmail(
  quoteEmail: string | null | undefined,
  customerEmail: string | null | undefined
): string {
  const own = quoteEmail?.trim();
  if (own) return own;
  return customerEmail?.trim() ?? "";
}
