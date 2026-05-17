import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import type { Customer } from "@/types/database";

interface CommercialWithoutPmaProps {
  customers: Customer[];
}

/**
 * Lists commercial customers missing a Pest Management Agreement so the
 * operator can chase them up. Hidden entirely when empty.
 */
export function CommercialWithoutPma({ customers }: CommercialWithoutPmaProps) {
  if (customers.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-500">PMA required</h3>
        </div>
        <p className="text-sm text-gray-400">
          All commercial customers have an active PMA. Nice.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">PMA required</h3>
        <span className="text-xs text-gray-400">{customers.length}</span>
      </div>
      <ul className="space-y-2">
        {customers.slice(0, 6).map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={ROUTES.customerDetail(c.id)}
                  className="text-sm font-medium text-amber-900 hover:underline"
                >
                  {c.name}
                </Link>
                {c.company_name && (
                  <p className="truncate text-xs text-amber-700">
                    {c.company_name}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                Commercial
              </span>
            </div>
          </li>
        ))}
        {customers.length > 6 && (
          <li className="pt-1 text-center">
            <Link
              href={`${ROUTES.CUSTOMERS}?type=commercial`}
              className="text-xs font-medium text-amber-800 hover:text-amber-900"
            >
              View all {customers.length}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
