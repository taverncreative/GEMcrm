import { LOGO_DATA_URI } from "@/lib/pdf/assets";
import { FOOTER_BAND_DATA_URI } from "@/lib/pdf/footer-band";

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

/**
 * The shared branded document FOOTER — the green contact + legal band shown on
 * EVERY page of EVERY generated PDF (quote, service sheet, agreement signed +
 * review, invoice). This is the single source of the footer markup: htmlToPdf
 * passes it as Puppeteer's `footerTemplate`, the only mechanism that pins a
 * footer to the bottom of every page including a partial last page in this
 * Chromium (a body `position:fixed` footer paints nothing; a table-footer-group
 * floats up on a short final page).
 *
 * The band is a pre-baked IMAGE (lib/pdf/footer-band.ts) rather than markup text
 * because the footerTemplate renders in a separate context where `@font-face`
 * does not load — the image bakes in the exact Montserrat + #9AC44B. Its TEXT
 * (phone / email / web + "trading name … Company number") is sourced from
 * FOOTER_CONTACT in lib/constants/branding.ts; after editing that, regenerate
 * the asset with `npx tsx scripts/generate-footer-band.ts`.
 *
 * translateY drops the band past Chromium's fixed ~5.3mm footer gap so it bleeds
 * flush to the bottom edge; width:100% bleeds L/R; line-height:0 kills the
 * inline-image gap.
 */
const FOOTER_BAND_SHIFT_PX = 24;

export function renderDocumentFooter(): string {
  return (
    `<div style="margin:0;padding:0;width:100%;line-height:0;` +
    `transform:translateY(${FOOTER_BAND_SHIFT_PX}px);">` +
    `<img src="${FOOTER_BAND_DATA_URI}" ` +
    `style="display:block;width:100%;height:auto;margin:0;padding:0;border:0;" />` +
    `</div>`
  );
}
