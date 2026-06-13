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
      address_line_1: input.address_line_1.trim(),
      address_line_2: emptyToNull(input.address_line_2),
      town: input.town.trim(),
      county: input.county.trim(),
      postcode: input.postcode.trim().toUpperCase(),
    })
    .select()
    .single();

  if (error) {
    console.error("[createSite]", error.code, error.message);
    throw new Error(`Failed to create site: ${error.message}`);
  }

  return data;
}
