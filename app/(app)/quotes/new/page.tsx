import Link from "next/link";
import { getQuoteCustomerOptions } from "@/lib/data/quotes";
import { QuoteForm } from "@/components/quotes/quote-form";
import { ROUTES } from "@/lib/constants/routes";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const customers = await getQuoteCustomerOptions();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <Link
          href={ROUTES.QUOTES}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Quotes
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">New quote</h1>
        <p className="mt-1 text-sm text-gray-500">
          Build a branded quote for an existing customer or a new prospect.
        </p>
      </div>
      <QuoteForm customers={customers} />
    </div>
  );
}
