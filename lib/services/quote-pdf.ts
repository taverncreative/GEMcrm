import { getQuoteById, setQuotePdfUrl } from "@/lib/data/quotes";
import { generateQuotePdf } from "@/lib/pdf/generate-quote-pdf";
import { uploadPdf } from "@/lib/storage/upload";
import type { Quote } from "@/types/database";

/** Storage key for a quote's cached PDF (single source of the convention). */
export function quotePdfPath(quoteId: string): string {
  return `quotes/${quoteId}/quote.pdf`;
}

/**
 * Render a quote's PDF, store it in the private `reports` bucket, persist the
 * URL on the row, and return both the URL and the rendered bytes.
 *
 * Called lazily from the on-demand route (/api/pdf/quote/[id]) on a cache miss,
 * NOT from create — so a slow Puppeteer render never blocks quote creation.
 * Pass an already-fetched `quote` to skip the re-read. `uploadPdf` upserts, so
 * concurrent first-downloads are safe (last write wins on the object and the
 * URL); both callers still get a valid buffer to serve.
 *
 * Returns null only when the quote can't be found; throws on a render/upload
 * failure (the route surfaces that as a 500).
 */
export async function renderAndStoreQuotePdf(
  quoteId: string,
  quote?: Quote
): Promise<{ pdfUrl: string; buffer: Buffer } | null> {
  const q = quote ?? (await getQuoteById(quoteId));
  if (!q) return null;

  const buffer = await generateQuotePdf(q);
  const pdfUrl = await uploadPdf(buffer, quotePdfPath(quoteId));
  await setQuotePdfUrl(quoteId, pdfUrl);
  return { pdfUrl, buffer };
}
