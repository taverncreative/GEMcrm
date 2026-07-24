"use client";

import { useRef, useState } from "react";
import { useBasket } from "@/components/library/basket-context";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { newId } from "@/lib/utils/id";
import { clampQuantity } from "@/lib/validation/print-order";
import { submitPrintOrderAction } from "@/app/(app)/library/actions";
import type { PrintOrderItem } from "@/types/database";

/**
 * The print basket — a floating button (with a live count) that opens a
 * panel to review quantities and confirm. Renders nothing until the basket
 * has hydrated from localStorage (avoids an SSR/first-paint flash) and while
 * empty.
 *
 * Confirm is fire-and-forget end to end: the action writes the order row and
 * returns instantly, POSTing to Spotlight in the background. The order id is
 * generated once and held in a ref so a retry after a transient failure
 * reuses the SAME id (idempotency) rather than minting a duplicate order.
 */

const DISCLAIMER =
  "These documents will be printed exactly as supplied. Confirming sends " +
  "them to be printed and billed separately. Please check the quantities " +
  "before you confirm.";

export function BasketBar() {
  const basket = useBasket();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable across retries until a submit succeeds — the idempotency key.
  const orderIdRef = useRef<string | null>(null);

  if (!basket.hydrated || basket.totalItems === 0) return null;

  async function confirm() {
    if (submitting) return;
    setError(null);
    if (!orderIdRef.current) orderIdRef.current = newId();
    const items: PrintOrderItem[] = basket.items.map((i) => ({
      reference: i.documentId,
      name: i.label,
      quantity: i.quantity,
    }));

    setSubmitting(true);
    const res = await submitPrintOrderAction({
      orderId: orderIdRef.current,
      items,
    });
    setSubmitting(false);

    if (res.success) {
      basket.clear();
      orderIdRef.current = null; // next order gets a fresh id
      setOpen(false);
      setConfirmed("Order sent to print.");
      window.setTimeout(() => setConfirmed(null), 5000);
    } else {
      // Keep orderIdRef so a retry reuses the same idempotency key.
      setError(res.message ?? "Could not send the order. Try again.");
    }
  }

  return (
    <>
      {/* Toast on success */}
      {confirmed && (
        <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg md:bottom-6">
          {confirmed}
        </div>
      )}

      {/* Floating basket button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-dark md:bottom-6"
        aria-label={`Print basket, ${basket.totalItems} document${basket.totalItems === 1 ? "" : "s"}`}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
        </svg>
        Basket
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-brand-darker">
          {basket.totalItems}
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Print basket">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl sm:inset-x-auto sm:right-6 sm:top-1/2 sm:bottom-auto sm:max-h-[80vh] sm:w-[28rem] sm:-translate-y-1/2 sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Print basket</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <ul className="divide-y divide-gray-100 px-5">
              {basket.items.map((item) => (
                <li key={item.documentId} className="flex items-center gap-3 py-3">
                  <p className="min-w-0 flex-1 truncate text-sm text-gray-900">{item.label}</p>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={item.quantity}
                    onChange={(e) =>
                      basket.setQuantity(item.documentId, clampQuantity(Number(e.target.value)))
                    }
                    className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    aria-label={`Quantity for ${item.label}`}
                  />
                  <button
                    type="button"
                    onClick={() => basket.remove(item.documentId)}
                    className="shrink-0 text-xs font-medium text-gray-400 hover:text-red-600"
                    aria-label={`Remove ${item.label} from basket`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div className="px-5 pt-2">
              <p className="text-xs text-gray-500">
                {basket.totalItems} document{basket.totalItems === 1 ? "" : "s"} ·{" "}
                {basket.totalQuantity} cop{basket.totalQuantity === 1 ? "y" : "ies"} total
              </p>
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
                {DISCLAIMER}
              </p>

              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
              {!online && (
                <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  You&rsquo;re offline — confirming a print order needs a connection.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => basket.clear()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Clear basket
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={submitting || !online}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Confirm order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
