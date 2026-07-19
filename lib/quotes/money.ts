/**
 * Quote money maths. All arithmetic runs in integer PENCE to avoid binary
 * float drift (0.1 + 0.2 !== 0.3), then converts back to 2dp GBP for storage
 * and display. This is the single source of truth for line totals, subtotal,
 * VAT and grand total, shared by the create action (authoritative server-side
 * compute) and the tests.
 *
 * Rules (Slice 1):
 *   line_total = qty * unit_price
 *   subtotal   = sum(line_total)
 *   VAT off  -> vat_amount = 0,                       total = subtotal
 *   VAT on   -> vat_amount = round(subtotal * rate%), total = subtotal + vat
 * Rounding is to the nearest penny at each stored value.
 */

export interface QuoteLineInput {
  description: string;
  qty: number;
  unit_price: number;
}

export interface ComputedQuoteLine extends QuoteLineInput {
  line_total: number;
}

export interface QuoteTotals {
  lineItems: ComputedQuoteLine[];
  subtotal: number;
  vat_amount: number;
  total: number;
}

/** GBP pounds -> integer pence, rounded to the nearest penny. Blank/NaN -> 0. */
export function toPence(pounds: number): number {
  const n = Number(pounds);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Integer pence -> 2dp GBP pounds. */
export function toPounds(pence: number): number {
  return Math.round(pence) / 100;
}

/**
 * Compute a quote's line totals and money fields from raw inputs. Pure and
 * deterministic. `vatRate` is a percentage (e.g. 20). When `vatRegistered`
 * is false the rate is ignored and vat_amount is 0.
 */
export function computeQuoteTotals(
  lines: QuoteLineInput[],
  vatRegistered: boolean,
  vatRate: number
): QuoteTotals {
  const lineItems: ComputedQuoteLine[] = [];
  let subtotalPence = 0;

  for (const line of lines) {
    const qty = Number(line.qty);
    const safeQty = Number.isFinite(qty) ? qty : 0;
    const unitPence = toPence(line.unit_price);
    const linePence = Math.round(safeQty * unitPence);
    subtotalPence += linePence;
    lineItems.push({
      description: line.description,
      qty: safeQty,
      unit_price: toPounds(unitPence),
      line_total: toPounds(linePence),
    });
  }

  const rate = Number(vatRate);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const vatPence = vatRegistered ? Math.round((subtotalPence * safeRate) / 100) : 0;
  const totalPence = subtotalPence + vatPence;

  return {
    lineItems,
    subtotal: toPounds(subtotalPence),
    vat_amount: toPounds(vatPence),
    total: toPounds(totalPence),
  };
}

/** Format a 2dp GBP amount for display, matching the PDF/Documents style. */
export function formatQuoteCurrency(value: number): string {
  return `£${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
