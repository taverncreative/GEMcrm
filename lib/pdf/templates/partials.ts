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
 *
 * The branded green contact footer is no longer a markup partial — it's a
 * baked image drawn by Puppeteer's footerTemplate (see htmlToPdf and
 * scripts/generate-footer-band.ts) so it pins to the bottom of every page.
 *
 * Styling lives in PDF_STYLES (lib/pdf/templates/styles.ts) under the
 * `.doc-header*` classes. The service report uses the header partial now;
 * the invoice + agreement move onto it in the next pass.
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
