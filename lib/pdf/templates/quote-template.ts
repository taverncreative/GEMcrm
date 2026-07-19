import type { Quote } from "@/types/database";
import { PDF_STYLES } from "./styles";
import { renderDocHeader } from "./partials";
import { BUSINESS } from "@/lib/constants/branding";

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

/** Preserve author line breaks in free text (terms/notes) while escaping. */
function multiline(value: string | null): string {
  if (!value) return "";
  return escape(value).replace(/\n/g, "<br />");
}

interface QuoteTemplateData {
  quote: Quote;
}

export function renderQuoteHtml({ quote }: QuoteTemplateData): string {
  const ref = quote.quote_number ?? quote.id.slice(0, 8).toUpperCase();
  // As-issued VAT: gated on THIS quote's stored VAT state, never the current
  // global flag — the same posture the invoice template uses.
  const hasVat = quote.vat_registered && Number(quote.vat_rate) > 0;
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>${PDF_STYLES}
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
      vertical-align: top;
    }
    .line-table td.num,
    .line-table th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .free-text {
      font-size: 11px;
      color: #374151;
      line-height: 1.6;
      white-space: normal;
    }
  </style>
</head>
<body>
<div class="page">

  ${renderDocHeader({
    docType: "Quote",
    meta: [
      { label: "Quote Number", value: ref },
      { label: "Date", value: formatDate(quote.created_at) },
      { label: "Valid Until", value: formatDate(quote.valid_until) },
      ...(hasVat
        ? [{ label: "VAT No.", value: BUSINESS.vatNumber || "[ADD VAT No.]" }]
        : []),
    ],
  })}

  <!-- Prepared for -->
  <div class="section avoid-break">
    <div class="section-title">Prepared for</div>
    <div class="section-card">
      <div class="field">
        <div class="field-value-large">${escape(quote.customer_name)}</div>
      </div>
      ${quote.customer_address ? `
      <div class="field">
        <div class="field-label">Address</div>
        <div class="field-value">${escape(quote.customer_address)}</div>
      </div>` : ""}
      ${quote.customer_email ? `
      <div class="field">
        <div class="field-label">Email</div>
        <div class="field-value">${escape(quote.customer_email)}</div>
      </div>` : ""}
    </div>
  </div>

  <!-- Line items -->
  <div class="section">
    <div class="section-title">Quotation</div>
    <div class="section-card">
      <table class="line-table">
        <thead>
          <tr>
            <th>Description</th>
            <th class="num" style="width:60px;">Qty</th>
            <th class="num" style="width:110px;">Unit price</th>
            <th class="num" style="width:110px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems
            .map(
              (li) => `
          <tr>
            <td>${escape(li.description)}</td>
            <td class="num">${escape(li.qty)}</td>
            <td class="num">${formatCurrency(Number(li.unit_price))}</td>
            <td class="num">${formatCurrency(Number(li.line_total))}</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>

      <div style="margin-top:16px;">
        ${hasVat ? `
        <div class="total-row">
          <span>Subtotal</span>
          <span>${formatCurrency(Number(quote.subtotal))}</span>
        </div>
        <div class="total-row">
          <span>VAT (${escape(quote.vat_rate)}%)</span>
          <span>${formatCurrency(Number(quote.vat_amount))}</span>
        </div>` : ""}
        <div class="total-row grand">
          <span>Total</span>
          <span>${formatCurrency(Number(quote.total))}</span>
        </div>
      </div>
    </div>
  </div>

  ${quote.terms ? `
  <!-- Terms -->
  <div class="section avoid-break">
    <div class="section-title">Terms</div>
    <div class="section-card">
      <p class="free-text">${multiline(quote.terms)}</p>
    </div>
  </div>` : ""}

  ${quote.notes ? `
  <!-- Notes -->
  <div class="section avoid-break">
    <div class="section-title">Notes</div>
    <div class="section-card">
      <p class="free-text">${multiline(quote.notes)}</p>
    </div>
  </div>` : ""}

</div>
</body>
</html>`;
}
