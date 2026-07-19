import { getQuoteById } from "@/lib/data/quotes";
import {
  renderAndStoreQuotePdf,
  quotePdfPath,
} from "@/lib/services/quote-pdf";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

function pdfResponse(buffer: Buffer, id: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${id.slice(0, 8)}.pdf"`,
      // Private (per-user auth-gated) + short cache: the object rarely changes.
      "Cache-Control": "private, max-age=60",
    },
  });
}

/**
 * On-demand quote PDF. Quotes are created WITHOUT a PDF (createQuoteAction no
 * longer renders one, so create is fast); this route builds it lazily on first
 * download and caches it to storage, then serves the cached copy thereafter.
 *
 * Cache states:
 *   - quote_pdf_url set + object present  -> stream the cached bytes.
 *   - quote_pdf_url null, OR object missing (stale URL) -> render, upload, set
 *     the URL, stream the fresh bytes.
 *
 * requireUser-gated (the PDF carries customer PII). Concurrent first-downloads
 * are safe: uploadPdf upserts and setQuotePdfUrl is last-write-wins, so both
 * requests render a valid PDF and converge on the same stored object.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await params;

  const quote = await getQuoteById(id);
  if (!quote) return new Response("Quote not found", { status: 404 });

  // Serve the cached PDF when the row points at one AND the object still exists.
  if (quote.quote_pdf_url) {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("reports")
      .download(quotePdfPath(id));
    if (!error && data) {
      const cached = Buffer.from(await data.arrayBuffer());
      return pdfResponse(cached, id);
    }
    // Fall through to regenerate: the URL was stale (object missing).
  }

  // Cache miss: render, cache (best-effort via the service), serve the bytes.
  const result = await renderAndStoreQuotePdf(id, quote);
  if (!result) return new Response("Quote not found", { status: 404 });
  return pdfResponse(result.buffer, id);
}
