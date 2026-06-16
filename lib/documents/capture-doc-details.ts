import type { Customer } from "@/types/database";
import { setCustomerDocDetailsAction } from "@/app/(app)/customers/actions";
import type { CustomerDocDetails } from "@/lib/data/customers";
import { db } from "@/lib/db";
import { enqueueAction } from "@/lib/db/outbox";

const ADDRESS_KEYS = [
  "address_line_1",
  "address_line_2",
  "town",
  "county",
  "postcode",
] as const;

/** Merge the captured details onto a customer (for the returned fresh
 *  record) and into a Dexie patch (for the optimistic local mirror). */
function applyDraft(customer: Customer, details: CustomerDocDetails) {
  const merged: Customer = { ...customer };
  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (details.email !== undefined) {
    const email = details.email.trim().toLowerCase();
    merged.email = email;
    patch.email = email;
  }
  for (const key of ADDRESS_KEYS) {
    if (details[key] !== undefined) {
      const value = details[key]!.trim() || null;
      merged[key] = value;
      patch[key] = value;
    }
  }
  return { merged, patch };
}

export interface CaptureDocDetailsResult {
  success: boolean;
  error?: string;
  /** The fresh customer with the captured fields merged in. */
  customer: Customer;
  /** True when captured OFFLINE (optimistic Dexie write + outbox enqueue) —
   *  the email isn't on the server yet, so any send must DEFER until it
   *  syncs. False for an online capture (already persisted server-side). */
  deferred: boolean;
}

/**
 * Persist the document-completeness details captured by the prompt,
 * offline-aware so an operator in the field can still capture the email at
 * the one moment the customer's in front of them:
 *
 *   - ONLINE  → a direct, AWAITED server write + Dexie mirror, so the very
 *               next thing the caller does (a send that re-reads the
 *               customer) sees the fresh email rather than the stale
 *               pre-prompt row. `deferred: false`.
 *   - OFFLINE → an optimistic Dexie write + an outbox enqueue, replayed
 *               server-side on reconnect via the registry — the same FIFO
 *               path bookings use. `deferred: true`: capture happened, but a
 *               send must wait until the email has synced.
 *
 * Shared by the gate provider and unit-tested directly against the real
 * outbox + drain (mirroring the relaxed-booking offline-sync test).
 */
export async function captureDocDetails(
  customer: Customer,
  details: CustomerDocDetails,
  online: boolean
): Promise<CaptureDocDetailsResult> {
  const { merged, patch } = applyDraft(customer, details);

  if (online) {
    const res = await setCustomerDocDetailsAction(customer.id, details);
    if (!res.success) {
      return { success: false, error: res.message, customer, deferred: false };
    }
    await db.customers.update(customer.id, patch);
    return { success: true, customer: merged, deferred: false };
  }

  // Offline: capture optimistically and queue for replay on reconnect.
  await db.customers.update(customer.id, patch);
  await enqueueAction({
    action_name: "setCustomerDocDetailsAction",
    args: [customer.id, details],
    entity_type: "customer",
    entity_id: customer.id,
  });
  return { success: true, customer: merged, deferred: true };
}
