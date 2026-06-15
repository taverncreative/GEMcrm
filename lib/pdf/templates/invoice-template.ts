import type { Customer, Invoice } from "@/types/database";
import { PDF_STYLES } from "./styles";
import { renderDocHeader } from "./partials";

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
}

export function renderInvoiceHtml({
  invoice,
  customer,
}: InvoiceTemplateData): string {
  const issued = invoice.issued_at ?? invoice.created_at;
  const ref = invoice.invoice_number ?? invoice.id.slice(0, 8).toUpperCase();
  const description =
    invoice.description?.trim() ||
    "Pest control service as agreed with the customer.";

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
    const zeroRated = vatAmt === 0;
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
            <td class="amount">${formatCurrency(subtotal)}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;">VAT ${zeroRated ? "(Zero rated)" : `(${vatRate}%)`}</td>
            <td class="amount" style="color:#6b7280;">${formatCurrency(vatAmt)}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:16px;">
        <div class="total-row">
          <span>Subtotal</span>
          <span>${formatCurrency(subtotal)}</span>
        </div>
        <div class="total-row">
          <span>VAT ${zeroRated ? "(Zero rated)" : `(${vatRate}%)`}</span>
          <span>${formatCurrency(vatAmt)}</span>
        </div>
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
