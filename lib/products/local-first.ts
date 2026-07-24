"use client";

import { db } from "@/lib/db";
import { enqueueAction } from "@/lib/db/outbox";
import type { Product } from "@/types/database";

/**
 * Create or update a product offline-first from the service-sheet picker
 * (the self-maintaining list).
 *
 * Local-first, mirroring the booking modal's optimistic path: write the row to
 * the Dexie `products` mirror immediately (so the type-ahead offers it at once,
 * online AND offline), enqueue a `saveProductAction` outbox entry carrying the
 * client-generated id, then kick the sync engine — online it drains right away,
 * offline it replays on reconnect. The service sheet never blocks on this: the
 * used-products ROW already snapshots brand+chemical, so the sheet is complete
 * regardless of when this product row syncs.
 *
 * `op: "create"` for a brand-new product (so a discarded stuck entry reverts
 * the local row); `op: "update"` for filling a missing chemical name on an
 * existing product (self-heal) — no revert.
 */
export async function saveProductLocalFirst(
  input: { id: string; brand_name: string; chemical_name: string | null },
  op: "create" | "update"
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.products.get(input.id);
  const row: Product = {
    id: input.id,
    brand_name: input.brand_name.trim(),
    chemical_name: input.chemical_name?.trim() ? input.chemical_name.trim() : null,
    created_by: existing?.created_by ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
  };
  await db.products.put(row);

  await enqueueAction({
    action_name: "saveProductAction",
    // FormData-shape args (saveProductAction reads these keys). objectToFormData
    // in the replay path rebuilds the FormData from exactly this.
    args: {
      id: row.id,
      brand_name: row.brand_name,
      chemical_name: row.chemical_name ?? "",
    },
    entity_type: "product",
    entity_id: row.id,
    op,
    ...(op === "create" ? { entity_ids: [row.id] } : {}),
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gemcrm:request-sync"));
  }
}
