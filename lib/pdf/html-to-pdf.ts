/**
 * HTML → PDF renderer.
 *
 * Two paths so the same module works locally AND on Vercel:
 *
 *   - **Vercel / serverless** (`process.env.VERCEL === "1"`): uses
 *     `puppeteer-core` + `@sparticuz/chromium`. The full puppeteer
 *     download (~280 MB Chromium) exceeds Vercel's 50 MB function-bundle
 *     cap; sparticuz ships a slim Chromium built specifically for
 *     Lambda-style environments.
 *   - **Local dev**: uses the full `puppeteer` package (devDependency)
 *     which downloads its own Chromium at install time — zero config.
 *
 * Callers don't need to know the difference — `htmlToPdf(html)` returns
 * a `Buffer` in both environments.
 */

import { FOOTER_BAND_ASPECT, FOOTER_BAND_DATA_URI } from "@/lib/pdf/footer-band";

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/** A4 page width in mm — the footer band is drawn at full page width. */
const A4_WIDTH_MM = 210;
/**
 * Display height of the full-width footer band, in mm. The band image spans
 * the whole page width, so its rendered height is width × aspect. This value
 * is ALSO the bottom page margin: setting the two equal makes the band fill
 * the bottom margin exactly, so it bleeds to the bottom + L + R edges with no
 * inset and flowing content stops right above it (never overlaps).
 */
const FOOTER_BAND_MM = A4_WIDTH_MM * FOOTER_BAND_ASPECT;

/**
 * Chromium anchors footerTemplate at a FIXED spot with a hard ~5.3mm (20px @
 * 96dpi) gap below it — `margin.bottom` reserves content space but does NOT
 * move the footer. We push the band down past that gap so it overshoots the
 * page edge and is clipped flush (no white sliver). 24px > the ~20px gap, so
 * the bottom always clips while only the band's solid-green bottom padding is
 * trimmed (text untouched); it also keeps the band top below where content
 * stops, so the two never overlap. Measured (rasterise + PIL): band bottom
 * flush, no overlap, on full AND partial pages.
 */
const FOOTER_BAND_SHIFT_PX = 24;

/**
 * Per-page footer for `page.pdf`. Puppeteer's footerTemplate is the only
 * mechanism that pins a footer to the bottom of EVERY page — including a
 * partial last page — in this Chromium (position:fixed paints nothing;
 * table-footer-group floats up on a short final page). The template renders in
 * a separate context where @font-face does NOT load, so the band is a
 * pre-baked image (exact Montserrat + #9AC44B) base64-inlined here — no runtime
 * file read, so no outputFileTracingIncludes entry is needed. width:100% makes
 * it span the full page width (bleeds L/R); translateY drops it to bleed to the
 * bottom edge. line-height:0 kills the inline-image gap.
 */
const FOOTER_TEMPLATE =
  `<div style="margin:0;padding:0;width:100%;line-height:0;` +
  `transform:translateY(${FOOTER_BAND_SHIFT_PX}px);">` +
  `<img src="${FOOTER_BAND_DATA_URI}" ` +
  `style="display:block;width:100%;height:auto;margin:0;padding:0;border:0;" />` +
  `</div>`;

async function launchBrowser() {
  if (IS_SERVERLESS) {
    // Imports are dynamic so the local-dev path doesn't try to resolve
    // sparticuz at build time on machines without it (and vice versa).
    const [{ default: chromium }, puppeteerCore] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    // sparticuz/chromium 148+ removed `defaultViewport` — let
    // puppeteer-core use its own default. We only render A4 PDFs so the
    // viewport doesn't affect output anyway.
    return puppeteerCore.default.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // Local dev — full puppeteer ships its own Chromium.
  const puppeteer = await import("puppeteer");
  return puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    // `load` is enough for inline HTML — no remote network calls to wait
    // on, and puppeteer-core's `setContent` types exclude the `networkidle*`
    // events since they don't apply meaningfully when there's no nav.
    await page.setContent(html, { waitUntil: "load" });
    // The brand font (Montserrat) is embedded as a base64 @font-face. Wait
    // for it to be fully parsed before printing, else the first PDF can
    // fall back to a system font (FOIT). No network — resolves immediately
    // once the inlined woff2 is decoded.
    await page.evaluate(async () => {
      await (document as unknown as { fonts: { ready: Promise<unknown> } })
        .fonts.ready;
    });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // The branded contact band is a per-page running footer (footerTemplate),
      // so it pins to the bottom of every page incl. a partial last page. An
      // empty header keeps the top clean. The band image fills the full page
      // width and its height equals margin.bottom, so it bleeds to the bottom +
      // L + R edges. Content keeps its normal 20mm top / 22mm L+R insets.
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: {
        top: "20mm",
        right: "22mm",
        bottom: `${FOOTER_BAND_MM}mm`,
        left: "22mm",
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
