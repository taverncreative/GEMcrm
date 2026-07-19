import type { Quote } from "@/types/database";
import { renderQuoteHtml } from "@/lib/pdf/templates/quote-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";

/** Render a quote to a branded A4 PDF buffer (shared htmlToPdf pipeline). */
export async function generateQuotePdf(quote: Quote): Promise<Buffer> {
  const html = renderQuoteHtml({ quote });
  return htmlToPdf(html);
}
