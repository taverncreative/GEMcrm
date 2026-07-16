"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { searchCustomersLocal, getSitesForCustomerLocal } from "@/lib/db/lookups";
import { pickPrimarySite } from "@/components/bookings/booking-modal";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import { formatAddress } from "@/lib/utils/format-address";
import { ROUTES } from "@/lib/constants/routes";
import type { Customer, Site } from "@/types/database";

/**
 * The top-level "New Agreement" front door.
 *
 * An agreement hangs off a SITE (which hangs off a customer), and the wizard
 * itself lives on the site page. Rather than rebuild that wizard, this is a
 * light two-step picker: choose the customer, then the site (defaulting to
 * their primary/registered-address site), then route to that site's agreement
 * wizard with it open. Reuses the booking modal's Dexie lookups and its
 * pickPrimarySite rule, so the default site matches the booking flow.
 */
export function NewAgreementLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New Agreement
      </button>
      {open && (
        <PickerModal
          onClose={() => setOpen(false)}
          onPicked={(siteId) => {
            setOpen(false);
            // Land on the site's Agreements card with the wizard already open.
            router.push(`${ROUTES.siteDetail(siteId)}?new=agreement#agreements`);
          }}
        />
      )}
    </>
  );
}

function PickerModal({
  onClose,
  onPicked,
}: {
  onClose: () => void;
  onPicked: (siteId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [siteId, setSiteId] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const runSearch = useCallback((v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setResults([]);
      setLoadingCustomers(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoadingCustomers(true);
      void searchCustomersLocal(v).then((data) => {
        setResults(data);
        setLoadingCustomers(false);
      });
    }, 200);
  }, []);

  const pickCustomer = useCallback(async (c: Customer) => {
    setCustomer(c);
    setLoadingSites(true);
    const list = await getSitesForCustomerLocal(c.id);
    setSites(list);
    setLoadingSites(false);
    // Default to the customer's primary (registered-address) site, the same
    // rule the booking flow uses.
    const primary = pickPrimarySite(c, list);
    setSiteId(primary?.id ?? "");
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-8">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">New Agreement</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* ── Customer ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Customer
            </h3>
            <div className="mt-2">
              {customer ? (
                <div className="flex items-center justify-between rounded-lg border border-brand bg-brand-soft px-3 py-2">
                  <p className="text-sm font-medium text-brand-darker">
                    {customerDisplayName(customer)}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomer(null);
                      setSites([]);
                      setSiteId("");
                      setQuery("");
                      setResults([]);
                    }}
                    className="text-xs font-medium text-brand-darker hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => runSearch(e.target.value)}
                    placeholder="Type a customer name…"
                    aria-label="Search customers"
                    className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  {loadingCustomers && (
                    <p className="mt-2 text-xs text-gray-400">Searching…</p>
                  )}
                  {!loadingCustomers && query.trim() && results.length === 0 && (
                    <p className="mt-2 text-xs text-gray-400">
                      No customers match that name.
                    </p>
                  )}
                  {results.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-100">
                      {results.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickCustomer(c)}
                          className="flex w-full flex-col items-start border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-900">
                            {customerDisplayName(c)}
                          </span>
                          {customerDisplayName(c) !== c.name && (
                            <span className="text-xs text-gray-400">{c.name}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ── Site ── */}
          {customer && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Site
              </h3>
              <div className="mt-2">
                {loadingSites ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">
                    Loading sites…
                  </p>
                ) : sites.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-xs text-gray-500">
                    <p>This customer has no site yet.</p>
                    <p className="mt-1">
                      An agreement needs a site.{" "}
                      <Link
                        href={`${ROUTES.CUSTOMERS}?customer=${customer.id}`}
                        className="font-medium text-brand-darker hover:underline"
                      >
                        Add one on the customer
                      </Link>
                      .
                    </p>
                  </div>
                ) : sites.length === 1 ? (
                  <div className="rounded-lg border border-brand bg-brand-soft px-3 py-2">
                    <p className="truncate text-sm font-medium text-brand-darker">
                      {formatAddress(sites[0]) || "Site"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100">
                      {sites.map((s) => (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50 has-[:checked]:bg-brand-soft"
                        >
                          <input
                            type="radio"
                            name="agreement-site"
                            value={s.id}
                            checked={siteId === s.id}
                            onChange={() => setSiteId(s.id)}
                            className="h-4 w-4 border-gray-300 text-brand focus:ring-brand"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                            {formatAddress(s) || "Site"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Primary site selected. Pick another if this agreement is
                      for a different site.
                    </p>
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 bg-white px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 sm:min-h-0"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!siteId}
            onClick={() => siteId && onPicked(siteId)}
            className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
