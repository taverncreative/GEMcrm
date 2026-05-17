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

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

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
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "22mm", bottom: "24mm", left: "22mm" },
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
