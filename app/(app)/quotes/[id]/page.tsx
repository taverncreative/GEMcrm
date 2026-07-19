import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuoteById } from "@/lib/data/quotes";
import { proxyAssetUrl } from "@/lib/storage/asset-url";
import { formatQuoteCurrency } from "@/lib/quotes/money";
import { ROUTES } from "@/lib/constants/routes";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await getQuoteById(id);
  if (!quote) notFound();

  const pdfHref = proxyAssetUrl(quote.quote_pdf_url);
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={ROUTES.QUOTES}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Quotes
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            Quote {quote.quote_number ?? quote.id.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {quote.customer_name} · Created {formatDate(quote.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pdfHref ? (
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Download PDF
            </a>
          ) : (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
              PDF not generated
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white p-5 shadow-sm">
        {/* Prepared for */}
        <div className="text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Prepared for
          </div>
          <div className="mt-1 font-medium text-gray-900">
            {quote.customer_name}
          </div>
          {quote.customer_address && (
            <div className="text-gray-500">{quote.customer_address}</div>
          )}
          {quote.customer_email && (
            <div className="text-gray-500">{quote.customer_email}</div>
          )}
        </div>

        {/* Line items */}
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2 text-gray-800">{li.description}</td>
                <td className="py-2 text-right tabular-nums text-gray-600">{li.qty}</td>
                <td className="py-2 text-right tabular-nums text-gray-600">
                  {formatQuoteCurrency(Number(li.unit_price))}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-800">
                  {formatQuoteCurrency(Number(li.line_total))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
          {quote.vat_registered && (
            <>
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatQuoteCurrency(Number(quote.subtotal))}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>VAT ({Number(quote.vat_rate)}%)</span>
                <span className="tabular-nums">{formatQuoteCurrency(Number(quote.vat_amount))}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold text-gray-900">
            <span>Total</span>
            <span className="tabular-nums">{formatQuoteCurrency(Number(quote.total))}</span>
          </div>
        </div>

        {(quote.valid_until || quote.terms || quote.notes) && (
          <div className="mt-5 space-y-3 border-t border-gray-100 pt-4 text-sm">
            {quote.valid_until && (
              <div>
                <span className="text-gray-400">Valid until: </span>
                <span className="text-gray-700">{formatDate(quote.valid_until)}</span>
              </div>
            )}
            {quote.terms && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Terms</div>
                <p className="mt-1 whitespace-pre-line text-gray-600">{quote.terms}</p>
              </div>
            )}
            {quote.notes && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Notes</div>
                <p className="mt-1 whitespace-pre-line text-gray-600">{quote.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
