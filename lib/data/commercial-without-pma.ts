import { createClient } from "@/lib/supabase/server";
import type { Customer } from "@/types/database";

/**
 * Commercial customers who don't yet have an active Pest Management Agreement.
 * Used by the dashboard widget so the operator can chase them up.
 */
export async function getCommercialCustomersWithoutPma(
  limit: number = 10
): Promise<Customer[]> {
  const supabase = await createClient();

  // Pull commercial customers + their active agreement count via a manual
  // join, since PostgREST can't express "where count(agreements) = 0" cleanly.
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("customer_type", "commercial")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getCommercialCustomersWithoutPma]", error.code, error.message);
    return [];
  }
  if (!customers || customers.length === 0) return [];

  const ids = customers.map((c) => c.id);
  const { data: agreements } = await supabase
    .from("agreements")
    .select("customer_id")
    .in("customer_id", ids)
    .eq("status", "active");

  const withActive = new Set((agreements ?? []).map((a) => a.customer_id));
  return customers
    .filter((c) => !withActive.has(c.id))
    .slice(0, limit) as Customer[];
}
