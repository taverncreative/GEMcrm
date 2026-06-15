/**
 * VAT handling for invoices.
 *
 * GEM is NOT currently VAT-registered (under the threshold), so invoices
 * charge no VAT — the gross amount IS the total, with no breakdown. The
 * logic is gated behind BUSINESS.vatRegistered (branding.ts) rather than
 * removed: when GEM registers, flipping that flag makes every path apply
 * the 20% standard-rated split below — a config change, not a rebuild.
 *
 * `grossVatSplit` is the dormant-but-tested registered-path math;
 * `invoiceVatFields` is the flag-gated shape both creation paths store.
 */

/** UK standard VAT rate (%). */
export const STANDARD_VAT_RATE = 20;

export interface VatSplit {
  /** Net amount (ex-VAT). */
  subtotal: number;
  /** VAT charged. */
  vat: number;
  /** Gross total (incl-VAT) — equals the input. */
  total: number;
  /** Rate applied (%). */
  rate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Split a gross (VAT-inclusive) total into net subtotal + VAT at the UK
 * standard rate.
 *
 *   grossVatSplit(105) → { subtotal: 87.50, vat: 17.50, total: 105, rate: 20 }
 *   grossVatSplit(120) → { subtotal: 100.00, vat: 20.00, total: 120, rate: 20 }
 */
export function grossVatSplit(gross: number): VatSplit {
  const total = round2(Number.isFinite(gross) && gross > 0 ? gross : 0);
  const subtotal = round2(total / (1 + STANDARD_VAT_RATE / 100));
  const vat = round2(total - subtotal);
  return { subtotal, vat, total, rate: STANDARD_VAT_RATE };
}

/** The invoice column values to store, gated on VAT registration. */
export interface InvoiceVatFields {
  amount: number;
  subtotal_amount: number | null;
  vat_amount: number | null;
  vat_rate: number;
}

/**
 * Map a gross amount to the invoice's amount/VAT columns.
 *
 *   not registered → no VAT: amount = gross, no breakdown, rate 0.
 *   registered     → 20% standard-rated split out of the gross total.
 *
 * Used identically by both creation paths so the flag is the only switch.
 */
export function invoiceVatFields(
  gross: number,
  vatRegistered: boolean
): InvoiceVatFields {
  const total = round2(Number.isFinite(gross) && gross > 0 ? gross : 0);
  if (!vatRegistered) {
    return { amount: total, subtotal_amount: null, vat_amount: null, vat_rate: 0 };
  }
  const { subtotal, vat, rate } = grossVatSplit(total);
  return { amount: total, subtotal_amount: subtotal, vat_amount: vat, vat_rate: rate };
}
