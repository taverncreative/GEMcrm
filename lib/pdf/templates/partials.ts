import { LOGO_DATA_URI } from "@/lib/pdf/assets";

/**
 * Shared, branded document partials (Track: document rebrand, Pass 1+2).
 *
 * The header + footer markup used to be copy-pasted into each template
 * (with a letter-"G" square and a plain text footer). These two partials
 * are the single source of truth for the GEM brand chrome:
 *
 *   - renderDocHeader — the reconstructed lockup (gem-mark logo +
 *     Montserrat-800 "GEM SERVICES" wordmark + tagline), a per-document
 *     type label, a right-aligned meta block, and the brand-rule underline.
 *   - renderDocFooter — the full-width dark-green contact strip. Contact
 *     details are a CLEARLY-MARKED placeholder until the real copy is
 *     supplied (then it's a one-line change here, for all documents).
 *
 * Styling lives in PDF_STYLES (lib/pdf/templates/styles.ts) under the
 * `.doc-header*` / `.doc-footer*` classes. The service report uses these
 * now; the invoice + agreement move onto them in the next pass.
 */

function escape(val: string | null | undefined): string {
  if (!val) return "";
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DocMetaRow {
  label: string;
  value: string;
}

export function renderDocHeader(opts: {
  docType: string;
  meta: DocMetaRow[];
}): string {
  return `
  <div class="doc-header">
    <div class="doc-brand">
      <div class="doc-lockup">
        <img class="doc-logo" src="${LOGO_DATA_URI}" alt="GEM Services" />
        <div>
          <div class="doc-wordmark">GEM SERVICES</div>
          <div class="doc-tagline">Professional Pest Management</div>
        </div>
      </div>
      <div class="doc-doctype">${escape(opts.docType)}</div>
    </div>
    <div class="doc-meta">
      ${opts.meta
        .map(
          (m) =>
            `<div class="doc-meta-row"><strong>${escape(
              m.label
            )}</strong>${escape(m.value)}</div>`
        )
        .join("")}
    </div>
  </div>`;
}

export function renderDocFooter(): string {
  // CLEARLY-MARKED placeholder — swap the bracketed fields for the real
  // contact details when supplied (one place, every document).
  return `
  <div class="doc-footer">
    <div class="doc-footer-top">
      <div class="doc-footer-co">GEM Services <span>&mdash; Professional Pest Management</span></div>
      <div class="doc-footer-ph">Placeholder &mdash; contact details to be supplied</div>
    </div>
    <div class="doc-footer-contacts">
      <span><span class="lab">Phone</span><span class="val ph">[ phone ]</span></span>
      <span><span class="lab">Email</span><span class="val ph">[ email ]</span></span>
      <span><span class="lab">Web</span><span class="val ph">[ website ]</span></span>
      <span><span class="lab">Address</span><span class="val ph">[ address line ]</span></span>
    </div>
  </div>`;
}
