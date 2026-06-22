import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";
import type { Site } from "@/types/database";
import type { SiteInput } from "@/lib/validation/site";

/** Convert empty strings to null for database storage. */
function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

export async function getSitesByCustomer(customerId: string): Promise<Site[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getSitesByCustomer]", error.code, error.message);
    throw new Error(`Failed to fetch sites: ${error.message}`);
  }

  return data;
}

export async function getSiteById(
  id: string | null | undefined
): Promise<Site | null> {
  // A draft job (Q2) has no site — callers following job -> site pass a
  // null id; short-circuit rather than round-trip a guaranteed miss.
  if (!id) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[getSiteById]", error.code, error.message);
    throw new Error(`Failed to fetch site: ${error.message}`);
  }

  return data;
}

export async function createSite(
  customerId: string,
  input: SiteInput,
  opts?: { id?: string }
): Promise<Site> {
  const supabase = await createClient();
  // `opts.id` from the offline-first path; upsert(onConflict:"id")
  // keeps a lost-ack replay re-run idempotent. Online callers omit it
  // → fresh UUID, behaves like an insert.
  const { data, error } = await supabase
    .from("sites")
    .upsert({
      id: opts?.id ?? newId(),
      customer_id: customerId,
      // Blank address fields → null (a bare site is just customer_id +
      // a blank address, created for a quick-add booking).
      address_line_1: emptyToNull(input.address_line_1),
      address_line_2: emptyToNull(input.address_line_2),
      town: emptyToNull(input.town),
      county: emptyToNull(input.county),
      postcode: input.postcode.trim()
        ? input.postcode.trim().toUpperCase()
        : null,
    })
    .select()
    .single();

  if (error) {
    console.error("[createSite]", error.code, error.message);
    throw new Error(`Failed to create site: ${error.message}`);
  }

  return data;
}

/**
 * Edit an existing site's address — a plain `.update().eq("id")`, ONLINE
 * ONLY (no RPC). A normal field update never touches `deleted_at`, so the
 * post-update RETURNING row still satisfies the SELECT policy
 * `USING (deleted_at IS NULL)` and there's no 42501 catch-22 — same as
 * {@link updateCustomer}. Sites were create-only until now; this is the
 * surface that lets an operator fix a bare/quick-add site's address.
 *
 * Field normalisation mirrors {@link createSite} (blank → null, postcode
 * uppercased). Returns the updated row so the caller can refresh the local
 * (Dexie) cache without waiting for the next sync pull.
 */
export async function updateSite(
  siteId: string,
  input: SiteInput
): Promise<Site> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .update({
      address_line_1: emptyToNull(input.address_line_1),
      address_line_2: emptyToNull(input.address_line_2),
      town: emptyToNull(input.town),
      county: emptyToNull(input.county),
      postcode: input.postcode.trim()
        ? input.postcode.trim().toUpperCase()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .select()
    .single();

  if (error) {
    console.error("[updateSite]", error.code, error.message);
    throw new Error(`Failed to update site: ${error.message}`);
  }

  return data;
}
