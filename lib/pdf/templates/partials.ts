import { LOGO_DATA_URI } from "@/lib/pdf/assets";
import { FOOTER_CONTACT } from "@/lib/constants/branding";

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
 *   - renderDocumentFooter — the green contact + legal band, rendered as
 *     Puppeteer's footerTemplate so it pins to the bottom of every page (see
 *     the function's own note for why it is text + CSS, not an image).
 *
 * Header styling lives in PDF_STYLES (lib/pdf/templates/styles.ts) under the
 * `.doc-header*` classes; the footer is fully self-styled (it renders in a
 * separate context that does not see PDF_STYLES).
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
 * review, invoice). Single source of the footer markup; htmlToPdf passes it as
 * Puppeteer's `footerTemplate` (displayHeaderFooter), the print mechanism that
 * repeats a footer on every page including a partial last page.
 *
 * WHY text + CSS, not the old baked IMAGE: header/footer templates render in a
 * separate print context, and in HEADLESS Chromium that context does not paint
 * IMAGES (data-URI or remote) — so the image band showed on local (full
 * puppeteer) but was MISSING on prod (@sparticuz/chromium on Vercel). Text and
 * inline CSS (incl. background-color) DO render there on both, so the band is
 * live text read straight from FOOTER_CONTACT (no baked asset to regenerate).
 *
 * FONT: that context also ignores @font-face, but it DOES use SYSTEM fonts (via
 * fontconfig). So Montserrat is shipped as system-font TTFs at /var/task/fonts
 * (traced in via next.config's outputFileTracingIncludes for the fonts dir) and
 * referenced by family name; see the font note inside the function. Falls back
 * to Open Sans / generic sans if unavailable — safe, never blank.
 *
 * Full-bleed: the footer region spans the FULL page width (not inset by the
 * content margins), so width:100% reaches both edges; the translateY + oversized
 * bottom padding bleed it to the bottom edge (see the bleed note in-function).
 * page.pdf's margin.bottom reserves the band height so content never overlaps,
 * and print-color-adjust:exact forces the green to print.
 */
export function renderDocumentFooter(): string {
  // Bullet (&#8226;), not a diamond (&#9670;): the diamond glyph is absent from
  // the serverless Linux fallback font, so it rendered as a blank gap on prod;
  // the bullet is near-universal across fonts.
  const separator = "&nbsp;&#8226;&nbsp;";
  const contactLine = [
    escape(FOOTER_CONTACT.phone),
    escape(FOOTER_CONTACT.email),
    escape(FOOTER_CONTACT.website),
  ].join(separator);
  // FONT: 'Montserrat' first. On serverless it resolves to the Montserrat TTFs
  // bundled at /var/task/fonts (fontconfig system fonts — the footer context
  // uses SYSTEM fonts, unlike @font-face which it ignores; see next.config
  // outputFileTracingIncludes "./fonts/**/*"). If that font isn't found (local
  // dev on macOS, or if the install ever fails on prod) it falls back to Open
  // Sans (the font @sparticuz/chromium ships) then a generic sans — safe, never
  // blank. Confirm the actual Montserrat render on PROD (pull the PDF); local
  // cannot exercise fontconfig.
  const fontStack = "'Montserrat','Open Sans',Arial,Helvetica,sans-serif";
  // BLEED: Chromium anchors the footer with a hard gap below it, so the band
  // would leave a white strip at the paper edge. translateY pushes the band
  // down past that gap, and the oversized bottom padding is what overshoots the
  // page edge and clips flush — so green runs to the very bottom while the text
  // stays well above the cut. Paired with html-to-pdf's margin.bottom, which
  // reserves the visible band height so content never overlaps.
  return (
    `<div style="width:100%;margin:0;padding:0;` +
    `font-family:${fontStack};` +
    `-webkit-print-color-adjust:exact;print-color-adjust:exact;` +
    `transform:translateY(28px);">` +
    `<div style="width:100%;box-sizing:border-box;background:#9AC44B;color:#ffffff;` +
    `padding:10px 26px 48px;text-align:center;">` +
    `<div style="font-size:9.5px;font-weight:700;letter-spacing:0.8px;line-height:1.5;">${contactLine}</div>` +
    `<div style="font-size:7.5px;font-weight:400;letter-spacing:0.25px;line-height:1.45;margin-top:3px;opacity:0.95;">${escape(FOOTER_CONTACT.legal)}</div>` +
    `</div></div>`
  );
}
