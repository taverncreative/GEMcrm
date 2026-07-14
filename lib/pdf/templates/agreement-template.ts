import type { Agreement, Site, Customer } from "@/types/database";
import { PDF_STYLES } from "./styles";
import { renderDocHeader } from "./partials";

function escape(val: string | null | undefined): string {
  if (!val) return "";
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date: string | null): string {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatCurrency(value: number | null): string {
  if (!value) return "\u2014";
  return `\u00A3${Number(value).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
}

function termsToHtml(terms: string): string {
  return terms
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^\d+\./.test(trimmed)) {
        return `<p><strong>${escape(trimmed)}</strong></p>`;
      }
      return `<p>${escape(trimmed)}</p>`;
    })
    .join("\n");
}

interface AgreementTemplateData {
  agreement: Agreement;
  customer: Customer;
  site: Site;
  /** "signed" (default) renders the signature images + signed date.
   *  "review" is the unsigned copy sent to the customer to read before
   *  signing: signature blocks show a "To be signed on the visit"
   *  placeholder, the signed date is omitted, and a review banner is added. */
  mode?: "signed" | "review";
}

export function renderAgreementHtml({
  agreement,
  customer,
  site,
  mode = "signed",
}: AgreementTemplateData): string {
  const review = mode === "review";
  const pests = agreement.pest_species ?? [];
  const addr = [site.address_line_1, site.address_line_2, site.town, site.county, site.postcode]
    .filter(Boolean)
    .join(", ");
  const ref = agreement.reference_number ?? agreement.id.slice(0, 8).toUpperCase();
  const headerMeta = [
    { label: "Agreement Date", value: formatDate(agreement.start_date) },
    ...(!review && agreement.signed_date
      ? [{ label: "Signed", value: formatDate(agreement.signed_date) }]
      : []),
    { label: "Reference", value: ref },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>${PDF_STYLES}</style>
</head>
<body>
<div class="page">

  ${review ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-weight:700;font-size:13px;text-align:center;padding:10px;border-radius:8px;margin-bottom:16px;letter-spacing:0.06em;">FOR REVIEW, NOT YET SIGNED</div>` : ""}

  <!-- Header (shared branded partial) -->
  ${renderDocHeader({
    docType: "Service Specification & Contract",
    meta: headerMeta,
  })}

  <!-- Client Details -->
  <div class="section avoid-break">
    <div class="section-title">Client Details</div>
    <div class="section-card">
      <div class="grid-2">
        <div>
          <div class="field">
            <div class="field-label">Customer</div>
            <div class="field-value-large">${escape(customer.name)}</div>
          </div>
          ${customer.company_name ? `
          <div class="field">
            <div class="field-label">Company</div>
            <div class="field-value">${escape(customer.company_name)}</div>
          </div>` : ""}
          ${agreement.contact_name ? `
          <div class="field">
            <div class="field-label">Contact</div>
            <div class="field-value">${escape(agreement.contact_name)}</div>
          </div>` : ""}
          ${agreement.contact_phone ? `
          <div class="field">
            <div class="field-label">Telephone</div>
            <div class="field-value">${escape(agreement.contact_phone)}</div>
          </div>` : ""}
          ${agreement.mobile ? `
          <div class="field">
            <div class="field-label">Mobile</div>
            <div class="field-value">${escape(agreement.mobile)}</div>
          </div>` : ""}
          ${agreement.contact_email ? `
          <div class="field">
            <div class="field-label">Email</div>
            <div class="field-value">${escape(agreement.contact_email)}</div>
          </div>` : ""}
        </div>
        <div>
          <div class="field">
            <div class="field-label">Site Address</div>
            <div class="field-value">${escape(addr)}</div>
          </div>
          ${agreement.invoice_address ? `
          <div class="field">
            <div class="field-label">Invoice Address</div>
            <div class="field-value">${escape(agreement.invoice_address)}</div>
          </div>` : ""}
        </div>
      </div>
    </div>
  </div>

  <!-- Agreement Details -->
  <div class="section avoid-break">
    <div class="section-title">Agreement Details</div>
    <div class="section-card">
      <div class="grid-3">
        <div class="field">
          <div class="field-label">Start Date</div>
          <div class="field-value-large">${formatDate(agreement.start_date)}</div>
        </div>
        <div class="field">
          <div class="field-label">Visit Frequency</div>
          <div class="field-value-large">${agreement.visit_frequency ?? "\u2014"} visits/year</div>
        </div>
        <div class="field">
          <div class="field-label">Contract Value</div>
          <div class="field-value-large">${formatCurrency(agreement.contract_value)}</div>
        </div>
      </div>

      ${pests.length > 0 ? `
      <div class="field" style="margin-top: 16px;">
        <div class="field-label">Pest Coverage</div>
        <div class="tag-list">
          ${pests.map((p) => `<span class="tag">${escape(p)}</span>`).join("")}
        </div>
      </div>` : ""}

      ${agreement.callout_terms ? `
      <div class="field" style="margin-top: 16px;">
        <div class="field-label">Call Out Arrangement</div>
        <div class="field-value">${escape(agreement.callout_terms)}</div>
      </div>` : ""}
    </div>
  </div>

  <!-- Terms & Conditions -->
  ${agreement.terms_text ? `
  <div class="section">
    <div class="section-title">Terms &amp; Conditions</div>
    <div class="terms-card">
      <div class="terms">
        ${termsToHtml(agreement.terms_text)}
      </div>
    </div>
  </div>` : ""}

  <!-- Signatures -->
  <div class="section avoid-break">
    <div class="section-title">Signatures</div>
    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-label">GEM Services Representative</div>
        ${!review && agreement.gem_signature_url
          ? `<img class="sig-img" src="${agreement.gem_signature_url}" />`
          : `<div class="sig-empty">${review ? "To be signed on the visit" : "Awaiting signature"}</div>`}
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 9px; color: #9ca3af;">Name</div>
          <div style="font-size: 11px; color: #374151;">GEM Services</div>
          ${!review && agreement.signed_date ? `
          <div style="font-size: 9px; color: #9ca3af; margin-top: 4px;">Date</div>
          <div style="font-size: 11px; color: #374151;">${formatDate(agreement.signed_date)}</div>
          ` : ""}
        </div>
      </div>
      <div class="sig-box">
        <div class="sig-label">Client Authorised Signatory</div>
        ${!review && agreement.client_signature_url
          ? `<img class="sig-img" src="${agreement.client_signature_url}" />`
          : `<div class="sig-empty">${review ? "To be signed on the visit" : "Awaiting signature"}</div>`}
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 9px; color: #9ca3af;">Name</div>
          <div style="font-size: 11px; color: #374151;">${!review && agreement.client_signatory_name ? escape(agreement.client_signatory_name) : "—"}</div>
          ${!review && agreement.signed_date ? `
          <div style="font-size: 9px; color: #9ca3af; margin-top: 4px;">Date</div>
          <div style="font-size: 11px; color: #374151;">${formatDate(agreement.signed_date)}</div>
          ` : ""}
        </div>
      </div>
    </div>
  </div>


</div>
</body>
</html>`;
}
