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

import { renderDocumentFooter } from "@/lib/pdf/templates/partials";
import { inlineStorageImages } from "@/lib/pdf/inline-storage-images";

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/** Content insets applied by page.pdf on every page. */
const TOP_MARGIN_MM = 20;
const SIDE_MARGIN_MM = 22;
/**
 * Bottom page margin reserved for the branded footer band. The footer is a
 * per-page running footer (displayHeaderFooter + footerTemplate), so this
 * reserves vertical space for it and flowing content stops right above it,
 * never overlapping. Sized to fit the band's two text lines + padding.
 */
const FOOTER_BAND_MM = 14;

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
  // H1: the reports bucket is private, so Puppeteer can't fetch embedded
  // photo/signature URLs. Resolve them to base64 data URIs first — after
  // this the HTML is fully self-contained and needs no network at render.
  const inlinedHtml = await inlineStorageImages(html);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    // `load` is enough for inline HTML — after inlineStorageImages every
    // image is a data: URI, so there are no remote network calls to wait
    // on. puppeteer-core's `setContent` types exclude the `networkidle*`
    // events since they don't apply meaningfully when there's no nav.
    await page.setContent(inlinedHtml, { waitUntil: "load" });
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
      // Branded band as a per-page running footer (footerTemplate), so it pins
      // to the bottom of every page incl. a partial last page. It is text + CSS
      // (not an image) because headless Chromium does not paint images in the
      // footer context — that was the prod "missing footer" bug. The footer
      // region spans the full page width, so the band bleeds L/R; margin.bottom
      // reserves its height so content never overlaps. Empty header, clean top.
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: renderDocumentFooter(),
      margin: {
        top: `${TOP_MARGIN_MM}mm`,
        right: `${SIDE_MARGIN_MM}mm`,
        bottom: `${FOOTER_BAND_MM}mm`,
        left: `${SIDE_MARGIN_MM}mm`,
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
