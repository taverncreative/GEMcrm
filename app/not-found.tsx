import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { BUSINESS } from "@/lib/constants/branding";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium uppercase tracking-wider text-gray-400">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          That link doesn&apos;t go anywhere in {BUSINESS.name} CRM. It may
          have moved, or the customer/job/agreement may have been deleted.
        </p>
        <Link
          href={ROUTES.DASHBOARD}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
