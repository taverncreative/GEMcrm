import { getQuoteById, setQuotePdfUrl } from "@/lib/data/quotes";
import { generateQuotePdf } from "@/lib/pdf/generate-quote-pdf";
import { uploadPdf } from "@/lib/storage/upload";

/**
 * Render a quote's PDF and store it in the private `reports` bucket at
 * `quotes/<id>/quote.pdf`, then persist the URL on the row. Returns the stored
 * URL, or null when the quote can't be found. Throws on a render/upload
 * failure (the caller decides whether that's fatal).
 *
 * `uploadPdf` upserts, so a re-run overwrites — this doubles as the regenerate
 * path after a template change.
 */
export async function renderAndStoreQuotePdf(
  quoteId: string
): Promise<string | null> {
  const quote = await getQuoteById(quoteId);
  if (!quote) return null;

  const buffer = await generateQuotePdf(quote);
  const pdfUrl = await uploadPdf(buffer, `quotes/${quoteId}/quote.pdf`);
  await setQuotePdfUrl(quoteId, pdfUrl);
  return pdfUrl;
}
