import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";
import type { Quote, QuoteLineItem } from "@/types/database";

// Quote numbering is assigned by the assign_quote_number DB trigger
// (migration 045): a dedicated quote_number_seq sequence produces a
// collision-proof Q-YYYY-NNN series. The app NEVER sets quote_number — that
// is the whole point of a sequence over an app-side max+1 (which races).

export interface CreateQuoteInput {
  customer_id: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_email: string | null;
  line_items: QuoteLineItem[];
  subtotal: number;
  vat_registered: boolean;
  vat_rate: number;
  vat_amount: number;
  total: number;
  terms: string | null;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
}

/**
 * Insert a quote. Deliberately omits `quote_number` so the DB trigger assigns
 * it from the sequence; the returned row carries the allocated number.
 */
export async function createQuote(input: CreateQuoteInput): Promise<Quote> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      id: newId(),
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      customer_address: input.customer_address,
      customer_email: input.customer_email,
      line_items: input.line_items,
      subtotal: input.subtotal,
      vat_registered: input.vat_registered,
      vat_rate: input.vat_rate,
      vat_amount: input.vat_amount,
      total: input.total,
      terms: input.terms,
      valid_until: input.valid_until,
      notes: input.notes,
      status: "draft",
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error) {
    console.error("[createQuote]", error.code, error.message);
    throw new Error(`Failed to create quote: ${error.message}`);
  }

  return data as Quote;
}

/**
 * Soft-delete a quote.
 *
 * Goes through the soft_delete_quote SECURITY DEFINER RPC (migration 045), the
 * same pattern as soft_delete_agreement (043) / soft_delete_job (038): the RLS
 * SELECT policy is `deleted_at IS NULL`, so a plain self-hiding update is
 * rejected with 42501 — the RPC is the narrowest bypass. Its `deleted_at is
 * null` predicate makes a replayed delete a no-op.
 */
export async function softDeleteQuote(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_quote", { p_id: id });

  if (error) {
    console.error("[softDeleteQuote]", error.code, error.message);
    throw new Error(`Failed to delete quote: ${error.message}`);
  }
}

/** Store the generated PDF URL on a quote. */
export async function setQuotePdfUrl(
  quoteId: string,
  pdfUrl: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("quotes")
    .update({ quote_pdf_url: pdfUrl })
    .eq("id", quoteId);

  if (error) {
    console.error("[setQuotePdfUrl]", error.code, error.message);
    throw new Error(`Failed to set quote PDF URL: ${error.message}`);
  }
}

/** A single quote by id (RLS filters soft-deleted rows). */
export async function getQuoteById(id: string): Promise<Quote | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[getQuoteById]", error.code, error.message);
    throw new Error(`Failed to fetch quote: ${error.message}`);
  }

  return (data as Quote) ?? null;
}

export interface QuoteListItem extends Quote {
  customer: { id: string; name: string; company_name: string | null } | null;
}

/** All live quotes, newest first, with the linked customer (if any) joined. */
export async function getAllQuotes(): Promise<QuoteListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select("*, customer:customers(id, name, company_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[getAllQuotes]", error.code, error.message);
    throw new Error(`Failed to fetch quotes: ${error.message}`);
  }

  // Supabase types the embedded relation as an array; unwrap the 1:1.
  return (data ?? []).map((row) => {
    const rel = (row as unknown as { customer: unknown }).customer;
    const customer = Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
    return { ...(row as unknown as Quote), customer } as QuoteListItem;
  });
}

export interface QuoteCustomerOption {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
}

/**
 * Lightweight customer list for the quote form's "pick existing customer"
 * picker. Carries the address parts so the client can prefill the
 * denormalised bill-to fields without a second round-trip.
 */
export async function getQuoteCustomerOptions(): Promise<QuoteCustomerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, name, company_name, email, address_line_1, address_line_2, town, county, postcode"
    )
    .order("name", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[getQuoteCustomerOptions]", error.code, error.message);
    throw new Error(`Failed to fetch customers: ${error.message}`);
  }

  return (data ?? []) as QuoteCustomerOption[];
}
