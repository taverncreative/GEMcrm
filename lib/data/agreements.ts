import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayUk, dateUk, dateUkOffset } from "@/lib/utils/today-uk";
import { newId } from "@/lib/utils/id";
import type { Agreement, Customer, Site } from "@/types/database";
import type { AgreementInput } from "@/lib/validation/agreement";
import { uploadBase64Image } from "@/lib/storage/upload";

function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

export async function getAgreementsByCustomer(
  customerId: string
): Promise<Agreement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .select("*")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getAgreementsByCustomer]", error.code, error.message);
    throw new Error(`Failed to fetch agreements: ${error.message}`);
  }

  return data;
}

export async function getAgreementsBySite(
  siteId: string
): Promise<Agreement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .select("*")
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getAgreementsBySite]", error.code, error.message);
    throw new Error(`Failed to fetch agreements: ${error.message}`);
  }

  return data;
}

export async function getAgreementById(
  id: string
): Promise<Agreement | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("[getAgreementById]", error.code, error.message);
    throw new Error(`Failed to fetch agreement: ${error.message}`);
  }

  return data;
}

export async function createAgreement(
  input: AgreementInput
): Promise<Agreement> {
  const agreementId = newId();

  let clientSigUrl: string | null = null;
  let gemSigUrl: string | null = null;

  if (input.client_signature?.startsWith("data:image")) {
    clientSigUrl = await uploadBase64Image(
      input.client_signature,
      `agreements/${agreementId}/client.png`
    );
  }

  if (input.gem_signature?.startsWith("data:image")) {
    gemSigUrl = await uploadBase64Image(
      input.gem_signature,
      `agreements/${agreementId}/gem.png`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .insert({
      id: agreementId,
      customer_id: input.customer_id,
      site_id: input.site_id,
      start_date: input.start_date,
      visit_frequency: input.visit_frequency,
      pest_species: input.pest_species,
      callout_terms: emptyToNull(input.callout_terms),
      contract_value: input.contract_value ?? null,
      status: input.status ?? "active",
      reference_number: emptyToNull(input.reference_number),
      contact_name: emptyToNull(input.contact_name),
      contact_phone: emptyToNull(input.contact_phone),
      contact_email: emptyToNull(input.contact_email),
      mobile: emptyToNull(input.mobile),
      invoice_address: emptyToNull(input.invoice_address),
      terms_text: emptyToNull(input.terms_text),
      client_signature_url: clientSigUrl,
      gem_signature_url: gemSigUrl,
      client_signatory_name: emptyToNull(input.client_signatory_name),
      signed_date: emptyToNull(input.signed_date)
        || (clientSigUrl || gemSigUrl ? todayUk() : null),
      end_date: emptyToNull(input.end_date)
        ?? (input.start_date
          ? dateUk(new Date(new Date(input.start_date).getTime() + 365 * 24 * 60 * 60 * 1000))
          : null),
    })
    .select()
    .single();

  if (error) {
    console.error("[createAgreement]", error.code, error.message);
    throw new Error(`Failed to create agreement: ${error.message}`);
  }

  return data;
}

export async function getActiveAgreements(): Promise<Agreement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .select("*")
    .eq("status", "active")
    .not("visit_frequency", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getActiveAgreements]", error.code, error.message);
    throw new Error(`Failed to fetch active agreements: ${error.message}`);
  }

  return data;
}

export interface AgreementWithContext extends Agreement {
  customer: Customer;
  site: Site;
}

interface GetAllAgreementsOptions {
  status?: "draft" | "active" | "paused" | "cancelled" | "all";
  search?: string;
}

export async function getAllAgreements(
  options: GetAllAgreementsOptions = {}
): Promise<AgreementWithContext[]> {
  const { status = "all", search } = options;
  const supabase = await createClient();

  // If searching, find matching customer IDs first
  let customerIds: string[] | null = null;
  if (search && search.trim() !== "") {
    const pattern = `%${search.trim()}%`;
    const { data: matchingCustomers } = await supabase
      .from("customers")
      .select("id")
      .or(`name.ilike.${pattern},company_name.ilike.${pattern}`);
    customerIds = (matchingCustomers ?? []).map((c) => c.id);
    if (customerIds.length === 0) return [];
  }

  let query = supabase
    .from("agreements")
    .select("*, customer:customers!inner(*), site:sites!inner(*)")
    // Discarded drafts (and any other soft-deleted agreement) never list.
    // RLS also hides them for user-scoped reads; this keeps the intent
    // explicit and holds if this fn ever runs under the service role.
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (customerIds) {
    query = query.in("customer_id", customerIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getAllAgreements]", error.code, error.message);
    throw new Error(`Failed to fetch agreements: ${error.message}`);
  }

  return (data ?? []) as unknown as AgreementWithContext[];
}

export async function getAgreementWithContext(
  id: string
): Promise<AgreementWithContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .select("*, customer:customers!inner(*), site:sites!inner(*)")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("[getAgreementWithContext]", error.code, error.message);
    throw new Error(`Failed to fetch agreement: ${error.message}`);
  }

  return data as unknown as AgreementWithContext;
}

export async function getJobsForAgreement(
  agreementId: string
): Promise<
  Array<{
    id: string;
    job_date: string;
    job_status: string;
    call_type: string | null;
  }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, job_date, job_status, call_type")
    .eq("agreement_id", agreementId)
    .order("job_date", { ascending: true });

  if (error) {
    console.error("[getJobsForAgreement]", error.code, error.message);
    return [];
  }

  return data ?? [];
}

export async function updateAgreementStatus(
  id: string,
  status: "active" | "paused" | "cancelled"
): Promise<Agreement> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[updateAgreementStatus]", error.code, error.message);
    throw new Error(`Failed to update agreement: ${error.message}`);
  }

  return data;
}

/**
 * Agreements where end_date falls within N days from now.
 */
export async function getExpiringAgreements(
  withinDays: number = 30
): Promise<AgreementWithContext[]> {
  const supabase = await createClient();
  const today = todayUk();
  const cutoffStr = dateUkOffset(withinDays);

  const { data, error } = await supabase
    .from("agreements")
    .select("*, customer:customers(*), site:sites(*)")
    .eq("status", "active")
    .is("deleted_at", null)
    .gte("end_date", today)
    .lte("end_date", cutoffStr)
    .order("end_date", { ascending: true });

  if (error) {
    console.error("[getExpiringAgreements]", error.code, error.message);
    return [];
  }

  return (data ?? []) as unknown as AgreementWithContext[];
}

/**
 * Soft-delete an agreement (Discard draft).
 *
 * Runs on the ADMIN client, not the user client: the RLS SELECT policy is
 * `deleted_at IS NULL` (migration 029), so a user-scoped self-hiding update
 * is rejected with 42501 (PostgREST's RETURNING row fails the read policy —
 * see the CLAUDE.md standing note). customers/jobs solved this with a
 * SECURITY DEFINER `soft_delete_<table>` RPC; agreements has none yet and
 * this slice is no-schema, so the requireUser-gated server action calls
 * this admin-client twin instead (same auth gate + privileged write shape
 * as the RPC). Follow-up debt: migration 043 `soft_delete_agreement`, then
 * swap this to the RPC for consistency with 032/038.
 *
 * The `deleted_at is null` predicate makes a replayed discard a no-op.
 */
export async function softDeleteAgreement(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("agreements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    console.error("[softDeleteAgreement]", error.code, error.message);
    throw new Error(`Failed to discard agreement: ${error.message}`);
  }
}
