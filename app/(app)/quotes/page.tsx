import Link from "next/link";
import { getAllQuotes } from "@/lib/data/quotes";
import { formatQuoteCurrency } from "@/lib/quotes/money";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import { ROUTES } from "@/lib/constants/routes";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function QuotesPage() {
  const quotes = await getAllQuotes();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Branded sales quotes for customers and prospects.
          </p>
        </div>
        <Link
          href={ROUTES.QUOTES_NEW}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          New quote
        </Link>
      </div>

      {quotes.length === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center shadow-sm">
          <p className="text-sm font-medium text-gray-900">No quotes yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Create your first quote to send to a customer.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Valid until</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const who = q.customer
                  ? customerDisplayName(q.customer)
                  : q.customer_name;
                return (
                  <tr key={q.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={ROUTES.quoteDetail(q.id)}
                        className="font-medium text-brand-darker hover:underline"
                      >
                        {q.quote_number ?? q.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-800">{who}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800">
                      {formatQuoteCurrency(Number(q.total))}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(q.valid_until)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(q.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
