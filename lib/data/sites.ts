import { createClient } from "@/lib/supabase/server";
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

export async function getSiteById(id: string): Promise<Site | null> {
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
  input: SiteInput
): Promise<Site> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .insert({
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
