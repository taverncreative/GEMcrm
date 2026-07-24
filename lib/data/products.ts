import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";
import type { Product } from "@/types/database";

interface SaveProductInput {
  /** Client-generated UUID from the offline-first path (applyLocal wrote this
   *  id locally; the outbox replay passes it so server == local). Omitted →
   *  a fresh UUID (behaves like an insert). */
  id?: string;
  brand_name: string;
  /** Null/blank allowed — the "chemical not supplied yet" case. */
  chemical_name?: string | null;
}

/**
 * All non-deleted products, brand-ordered — the reference list for the
 * service-sheet type-ahead. (The picker itself reads the Dexie mirror via
 * `searchProductsLocal` so it works offline; this server read seeds the mirror
 * and backs any online-only surface.)
 */
export async function getAllProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("brand_name", { ascending: true });

  if (error) {
    console.error("[getAllProducts]", error.code, error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Create or update a product (self-maintaining list).
 *
 * upsert(onConflict:"id") makes a lost-ack outbox replay idempotent and
 * doubles as the "fill the missing chemical name later" update path. Mirrors
 * saveBlockedPeriod / createTask.
 *
 * `created_by` is intentionally omitted (column DEFAULTs to auth.uid() on
 * insert; an update must not overwrite the author). `chemical_name` empty
 * string is stored as null.
 */
export async function saveProduct(input: SaveProductInput): Promise<Product> {
  const supabase = await createClient();
  const chemical = (input.chemical_name ?? "").trim();

  const { data, error } = await supabase
    .from("products")
    .upsert(
      {
        id: input.id ?? newId(),
        brand_name: input.brand_name.trim(),
        chemical_name: chemical === "" ? null : chemical,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[saveProduct]", error.code, error.message);
    throw new Error(`Failed to save product: ${error.message}`);
  }
  return data;
}
