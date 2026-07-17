import type { Job, Site, Customer } from "@/types/database";
import { formatCallType, RISK_LEVEL_LABELS } from "@/lib/constants/job-labels";
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

function riskBadgeClass(level: string): string {
  switch (level) {
    case "low": return "badge-green";
    case "medium": return "badge-amber";
    case "high": return "badge-red";
    default: return "badge-grey";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "scheduled": return "badge-blue";
    case "in_progress": return "badge-amber";
    case "completed": return "badge-green";
    default: return "badge-grey";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "scheduled": return "Scheduled";
    case "in_progress": return "In Progress";
    case "completed": return "Completed";
    default: return status;
  }
}

interface JobReportData {
  job: Job;
  site: Site;
  customer: Customer;
}

export function renderJobReportHtml({
  job,
  site,
  customer,
}: JobReportData): string {
  const addr = [site.address_line_1, site.address_line_2, site.town, site.county, site.postcode]
    .filter(Boolean)
    .join(", ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>${PDF_STYLES}</style>
</head>
<body>
<div class="page">

  <!-- Header (shared branded partial) -->
  ${renderDocHeader({
    docType: "Pest Control Service Report",
    meta: [
      { label: "Visit Date", value: formatDate(job.job_date) },
      {
        label: "Reference",
        value: job.reference_number ?? job.id.slice(0, 8).toUpperCase(),
      },
    ],
  })}

  <!-- Customer & Site -->
  <div class="section avoid-break">
    <div class="section-title">Customer &amp; Site</div>
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
        <div>
          <div class="field">
            <div class="field-label">Site Address</div>
            <div class="field-value">${escape(addr)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Visit Details -->
  <div class="section avoid-break">
    <div class="section-title">Visit Details</div>
    <div class="section-card">
      <div class="grid-3">
        <div class="field">
          <div class="field-label">Date</div>
          <div class="field-value-large">${formatDate(job.job_date)}</div>
        </div>
        ${job.call_type ? `
        <div class="field">
          <div class="field-label">Call Type</div>
          <div class="field-value-large">${escape(formatCallType(job.call_type, job.call_type_other_desc))}</div>
        </div>` : ""}
        <div class="field">
          <div class="field-label">Status</div>
          <div class="field-value">
            <span class="badge ${statusBadgeClass(job.job_status)}">${statusLabel(job.job_status)}</span>
          </div>
        </div>
      </div>
      ${job.pest_species.length > 0 ? `
      <div class="field" style="margin-top: 16px;">
        <div class="field-label">Pest Species</div>
        <div class="tag-list">
          ${job.pest_species.map((p) => `<span class="tag">${escape(p)}</span>`).join("")}
        </div>
      </div>` : ""}
    </div>
  </div>

  <!-- Findings & Recommendations -->
  ${job.findings || job.recommendations ? `
  <div class="section avoid-break">
    <div class="section-title">Findings &amp; Recommendations</div>
    <div class="section-card">
      ${job.findings ? `
      <div class="field">
        <div class="field-label">Findings</div>
        <div class="field-value">${escape(job.findings)}</div>
      </div>` : ""}
      ${job.recommendations ? `
      <div class="field">
        <div class="field-label">Recommendations</div>
        <div class="field-value">${escape(job.recommendations)}</div>
      </div>` : ""}
    </div>
  </div>` : ""}

  <!-- Internal Notes (job.report_notes) are DELIBERATELY OMITTED here: this
       PDF is the customer-facing service report, and report_notes is the
       operator's internal field ("Internal Notes" in the service-sheet form,
       e.g. gate codes / access notes). The data is untouched — it still shows
       in the in-app job view; it just must never reach the customer doc. -->

  <!-- Treatment -->
  ${job.method_used?.length > 0 || job.pesticides_used ? `
  <div class="section avoid-break">
    <div class="section-title">Treatment</div>
    <div class="section-card">
      ${job.method_used?.length > 0 ? `
      <div class="field">
        <div class="field-label">Treatment Carried Out</div>
        <div class="tag-list">
          ${job.method_used.map((m) => `<span class="tag">${escape(m)}</span>`).join("")}
        </div>
      </div>` : ""}
      ${job.pesticides_used ? `
      <div class="field">
        <div class="field-label">Pesticides Used</div>
        <div class="field-value">${escape(job.pesticides_used)}</div>
      </div>` : ""}
    </div>
  </div>` : ""}

  <!-- Risk Assessment -->
  ${job.risk_level ? `
  <div class="section avoid-break">
    <div class="section-title">Risk Assessment</div>
    <div class="section-card">
      <div class="field">
        <div class="field-label">Risk Level</div>
        <div class="field-value">
          <span class="badge ${riskBadgeClass(job.risk_level)}">${escape(RISK_LEVEL_LABELS[job.risk_level] ?? job.risk_level)}</span>
        </div>
      </div>
      ${job.risk_comments ? `
      <div class="field">
        <div class="field-label">Risk Assessment Comments</div>
        <div class="field-value">${escape(job.risk_comments)}</div>
      </div>` : ""}
    </div>
  </div>` : ""}

  <!-- Additional Photos -->
  ${job.photo_urls?.length > 0 ? `
  <div class="section avoid-break">
    <div class="section-title">Additional Photos</div>
    <div class="section-card">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        ${job.photo_urls.map((url) => `<img src="${escape(url)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:4px;border:1px solid #e5e7eb;" />`).join("")}
      </div>
    </div>
  </div>` : ""}

  <!-- Signatures -->
  <div class="section avoid-break">
    <div class="section-title">Signatures</div>
    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-label">Technician Signature</div>
        ${job.technician_signature_url
          ? `<img class="sig-img" src="${job.technician_signature_url}" />`
          : `<div class="sig-empty">Not signed</div>`}
      </div>
      <div class="sig-box">
        <div class="sig-label">Client Signature</div>
        ${job.client_signature_url
          ? `<img class="sig-img" src="${job.client_signature_url}" />`
          : `<div class="sig-empty">Not signed</div>`}
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}
