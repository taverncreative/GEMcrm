import { createClient } from "@/lib/supabase/server";
import type { Invoice, Customer } from "@/types/database";

export interface InvoiceListItem extends Invoice {
  customer: Customer | null;
}

/**
 * Fetch all invoices with the customer joined for the invoices list view.
 * Newest first; bounded to 200 to keep the page responsive at scale.
 */
export async function getInvoiceList(): Promise<InvoiceListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, customer:customers(*)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[getInvoiceList]", error.code, error.message);
    return [];
  }
  // PostgREST returns relations as arrays — unwrap.
  return (data ?? []).map((row) => {
    const cust = Array.isArray((row as { customer: unknown }).customer)
      ? ((row as unknown as { customer: Customer[] }).customer[0] ?? null)
      : ((row as unknown as { customer: Customer | null }).customer ?? null);
    return { ...(row as Invoice), customer: cust };
  });
}
