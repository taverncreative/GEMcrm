"use server";

import { saveProduct } from "@/lib/data/products";
import { ProductSchema } from "@/lib/validation/product";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

/**
 * Create or update a product (self-maintaining list — new brands are added
 * from the service-sheet fill form; the "fill missing chemical" path updates).
 *
 * Offline-first contract (mirrors saveBlockedPeriodAction): the picker's
 * local-first wrapper writes the row to Dexie and enqueues a create/update
 * outbox entry carrying the client-generated `id`, then (online) invokes this
 * with the SAME id. saveProduct upserts on id, so the online call and any later
 * outbox replay are idempotent. Registered in lib/sync/registry.ts under the
 * same action name for replay.
 */
export async function saveProductAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();

  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const result = ProductSchema.safeParse({
    brand_name: str("brand_name"),
    chemical_name: str("chemical_name"),
  });

  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  const id = str("id") || undefined;
  const { brand_name, chemical_name } = result.data;

  try {
    await saveProduct({ id, brand_name, chemical_name });
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to save product",
    };
  }

  return { success: true, errors: {}, message: "Product saved" };
}
