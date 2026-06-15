import type { Customer, Invoice, Site } from "@/types/database";
import { PDF_STYLES } from "./styles";
import { renderDocHeader } from "./partials";
import { BUSINESS } from "@/lib/constants/branding";

/** Single-line postal address from the structured fields, blank-safe (drops
 *  empty lines) — the same pattern the report/agreement templates use. */
function joinAddress(
  source: Pick<
    Customer | Site,
    "address_line_1" | "address_line_2" | "town" | "county" | "postcode"
  > | null
): string {
  if (!source) return "";
  return [
    source.address_line_1,
    source.address_line_2,
    source.town,
    source.county,
    source.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

function escape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatCurrency(value: number): string {
  return `£${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface InvoiceTemplateData {
  invoice: Invoice;
  customer: Customer;
  /** The job's site, used only as a fallback bill-to address when the
   *  customer has no address of their own. */
  site?: Site | null;
}

export function renderInvoiceHtml({
  invoice,
  customer,
  site,
}: InvoiceTemplateData): string {
  // Bill-to address: prefer the customer's saved address, fall back to the
  // site address if there is one, and omit the line entirely when both are
  // blank (self-omitting via the blank-safe join).
  const billToAddress = joinAddress(customer) || joinAddress(site ?? null);
  const issued = invoice.issued_at ?? invoice.created_at;
  const ref = invoice.invoice_number ?? invoice.id.slice(0, 8).toUpperCase();
  const description =
    invoice.description?.trim() ||
    "Pest control service as agreed with the customer.";

  // Render as-issued: VAT display follows THIS invoice's own stored VAT
  // state, never the current global BUSINESS.vatRegistered flag. So
  // regenerating a pre-registration (no-VAT) invoice after GEM registers
  // never retro-adds VAT rows it was never issued with, and a VAT invoice
  // always shows its breakdown even if the flag were later turned off.
  const hasVat = invoice.vat_amount != null && Number(invoice.vat_rate) > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>${PDF_STYLES}
    .invoice-meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 16px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 11px;
      border-top: 1px solid #e5e7eb;
    }
    .total-row.grand {
      border-top: 2px solid #1f2937;
      font-weight: 700;
      font-size: 13px;
      padding-top: 12px;
      margin-top: 8px;
    }
    .line-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .line-table th {
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
      padding: 6px 8px;
    }
    .line-table td {
      padding: 10px 8px;
      font-size: 11px;
      color: #1f2937;
      border-bottom: 1px solid #f3f4f6;
    }
    .line-table td.amount {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header (shared branded partial) -->
  ${renderDocHeader({
    docType: "Invoice",
    meta: [
      { label: "Invoice Number", value: ref },
      { label: "Date Issued", value: formatDate(issued) },
      { label: "Date Due", value: formatDate(invoice.due_date) },
      // VAT number — shown only when THIS invoice carries VAT (as-issued).
      // Empty number on a VAT invoice → [ADD VAT No.] placeholder guard.
      ...(hasVat
        ? [{ label: "VAT No.", value: BUSINESS.vatNumber || "[ADD VAT No.]" }]
        : []),
    ],
  })}

  <!-- Bill to -->
  <div class="section avoid-break">
    <div class="section-title">Bill to</div>
    <div class="section-card">
      <div class="field">
        <div class="field-value-large">${escape(customer.name)}</div>
      </div>
      ${customer.company_name ? `
      <div class="field">
        <div class="field-value">${escape(customer.company_name)}</div>
      </div>` : ""}
      ${billToAddress ? `
      <div class="field">
        <div class="field-label">Address</div>
        <div class="field-value">${escape(billToAddress)}</div>
      </div>` : ""}
      ${customer.email ? `
      <div class="field">
        <div class="field-label">Email</div>
        <div class="field-value">${escape(customer.email)}</div>
      </div>` : ""}
      ${customer.phone ? `
      <div class="field">
        <div class="field-label">Phone</div>
        <div class="field-value">${escape(customer.phone)}</div>
      </div>` : ""}
    </div>
  </div>

  <!-- Line items -->
  ${(() => {
    const total = Number(invoice.amount);
    const subtotal = Number(invoice.subtotal_amount ?? total);
    const vatAmt = Number(invoice.vat_amount ?? 0);
    const vatRate = Number(invoice.vat_rate ?? 20);
    // No stored VAT → single line + total, no VAT row, no breakdown.
    // Stored VAT → the split shown in full. Gated on the invoice itself.
    return `
  <div class="section">
    <div class="section-title">Services</div>
    <div class="section-card">
      <table class="line-table">
        <thead>
          <tr>
            <th>Description</th>
            <th style="text-align:right;width:120px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escape(description)}</td>
            <td class="amount">${formatCurrency(hasVat ? subtotal : total)}</td>
          </tr>
          ${hasVat ? `
          <tr>
            <td style="color:#6b7280;">VAT (${vatRate}%)</td>
            <td class="amount" style="color:#6b7280;">${formatCurrency(vatAmt)}</td>
          </tr>` : ""}
        </tbody>
      </table>

      <div style="margin-top:16px;">
        ${hasVat ? `
        <div class="total-row">
          <span>Subtotal</span>
          <span>${formatCurrency(subtotal)}</span>
        </div>
        <div class="total-row">
          <span>VAT (${vatRate}%)</span>
          <span>${formatCurrency(vatAmt)}</span>
        </div>` : ""}
        <div class="total-row grand">
          <span>Total due</span>
          <span>${formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  </div>`;
  })()}

  <!-- Payment details -->
  <div class="section avoid-break">
    <div class="section-title">Payment</div>
    <div class="section-card">
      <p style="font-size:11px;color:#374151;line-height:1.6;">
        Please make payment within 7 working days of the invoice date.
        Bank transfer or cheque accepted &mdash; contact GEM Services for
        account details if needed.
      </p>
      <p style="font-size:11px;color:#374151;line-height:1.6;margin-top:8px;">
        Quote invoice number <strong>${escape(ref)}</strong> with payment.
      </p>
    </div>
  </div>


</div>
</body>
</html>`;
}
