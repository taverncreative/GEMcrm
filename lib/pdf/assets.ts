import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Brand assets inlined for the PDF renderer (Track: document rebrand).
 *
 * `htmlToPdf` uses puppeteer `setContent` with NO base URL and no reliable
 * network (especially serverless Chromium), so the logo + fonts can't be
 * referenced by `public/...` path or a Google-Fonts <link> — they must be
 * embedded as base64 `data:` URIs in the HTML. These are read ONCE at
 * module load and cached in the consts below.
 *
 * Serverless note: the files are read at runtime via `fs`, which Next's
 * output tracing can't infer from a computed path — so `next.config.ts`
 * lists them under `outputFileTracingIncludes` (the exact same pattern the
 * @sparticuz/chromium blobs already use). Without that, the read throws on
 * Vercel and every PDF fails.
 */

const ROOT = process.cwd();

function readBase64(relPath: string): string {
  return readFileSync(join(ROOT, relPath)).toString("base64");
}

/**
 * Gem-mark logo (RGB PNG, 733×722). The "GEM SERVICES" wordmark is NOT in
 * this file (it's only in the CMYK print master) — the lockup reconstructs
 * the wordmark in Montserrat 800 (see renderDocHeader).
 */
export const LOGO_DATA_URI = `data:image/png;base64,${readBase64(
  "public/logo/gem-services-logo.png"
)}`;

/**
 * Montserrat (latin) embedded as a single VARIABLE woff2 spanning the
 * weight axis. Google serves Montserrat as a variable font, so one file
 * yields true 400 (body) / 600 (labels) / 700 (titles) / 800 (wordmark)
 * weights — no faux-bold, ~38 KB once.
 *
 * `font-display: swap` is belt-and-braces; `htmlToPdf` additionally awaits
 * `document.fonts.ready` before printing so the PDF never falls back.
 */
const MONTSERRAT_WOFF2 = readBase64("lib/pdf/fonts/montserrat-var.woff2");

export const MONTSERRAT_FACE_CSS = `
  @font-face {
    font-family: 'Montserrat';
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url(data:font/woff2;base64,${MONTSERRAT_WOFF2}) format('woff2');
  }`;
