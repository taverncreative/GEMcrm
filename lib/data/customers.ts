import { createClient } from "@/lib/supabase/server";
import { todayUk } from "@/lib/utils/today-uk";
import { newId } from "@/lib/utils/id";
import type {
  Customer,
  CustomerType,
  Site,
  Job,
  Agreement,
} from "@/types/database";
import type { CustomerInput } from "@/lib/validation/customer";

/** Convert empty strings to null for database storage. */
function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export async function getCustomers(
  options: PaginationOptions = {}
): Promise<Customer[]> {
  const { limit = 50, offset = 0 } = options;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[getCustomers]", error.code, error.message);
    throw new Error(`Failed to fetch customers: ${error.message}`);
  }

  return data;
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[getCustomerById]", error.code, error.message);
    throw new Error(`Failed to fetch customer: ${error.message}`);
  }

  return data;
}

/**
 * Optional sites to create alongside a customer. Mirrors the columns we
 * store on the `sites` table (and matches `SiteInput` from validation),
 * but each field is independently optional here — the action upstream
 * is responsible for deciding which rows are "filled enough" to insert.
 */
export interface SiteInputLoose {
  /** Client-generated id from the offline-first path — applyLocal wrote
   *  this UUID locally; the replay passes it so server == local. Plain
   *  online callers omit it. */
  id?: string;
  address_line_1?: string;
  address_line_2?: string;
  town?: string;
  county?: string;
  postcode?: string;
}

/** True when the address has enough to be a useful site (line 1 + town
 *  at minimum — county and postcode are often omitted in UK addresses). */
function hasUsableSiteAddress(input: SiteInputLoose): boolean {
  return Boolean(
    emptyToNull(input.address_line_1) && emptyToNull(input.town)
  );
}

/** Row shape for inserting a site — used after we've decided to insert. */
function siteRow(customerId: string, input: SiteInputLoose) {
  return {
    id: input.id ?? newId(),
    customer_id: customerId,
    address_line_1: emptyToNull(input.address_line_1),
    address_line_2: emptyToNull(input.address_line_2),
    town: emptyToNull(input.town),
    county: emptyToNull(input.county),
    postcode: emptyToNull(input.postcode)?.toUpperCase() ?? null,
  };
}

export async function createCustomer(
  input: CustomerInput,
  additionalSites: SiteInputLoose[] = [],
  opts?: {
    id?: string;
    /** Client id for the site auto-created from the customer's own
     *  address block (the primary candidate below). Same offline-first
     *  contract as `id`. `additionalSites` entries carry their own. */
    primarySiteId?: string;
  }
): Promise<Customer> {
  const supabase = await createClient();
  // `opts.id` from the offline-first path (applyLocal wrote this client
  // UUID locally; the outbox replay passes it so server == local).
  // upsert(onConflict:"id") makes a lost-ack replay re-run idempotent.
  // Plain online callers omit it → fresh UUID, behaves like an insert
  // (no conflict possible on a brand-new id).
  const { data, error } = await supabase
    .from("customers")
    .upsert({
      id: opts?.id ?? newId(),
      name: input.name.trim(),
      company_name: emptyToNull(input.company_name),
      email: emptyToNull(input.email),
      phone: emptyToNull(input.phone),
      mobile: emptyToNull(input.mobile),
      position: emptyToNull(input.position),
      address_line_1: emptyToNull(input.address_line_1),
      address_line_2: emptyToNull(input.address_line_2),
      town: emptyToNull(input.town),
      county: emptyToNull(input.county),
      // Normalise postcode to uppercase, no leading/trailing whitespace.
      postcode: emptyToNull(input.postcode)?.toUpperCase() ?? null,
      website: emptyToNull(input.website),
      notes: emptyToNull(input.notes),
      annual_contract_value:
        typeof input.annual_contract_value === "number"
          ? input.annual_contract_value
          : null,
      customer_type: input.customer_type ?? "commercial",
    })
    .select()
    .single();

  if (error) {
    console.error("[createCustomer]", error.code, error.message);
    throw new Error(`Failed to create customer: ${error.message}`);
  }

  // Auto-create sites from the address fields we collected. For domestic
  // customers this is "the home where service happens"; for commercial it
  // doubles as the registered address and the primary service location.
  // Subsequent rows in `additionalSites` come from commercial customers
  // with multiple locations (added inline on the create form).
  //
  // Each row is independent — we insert any that have enough address to
  // be useful and silently skip the rest. We don't fail the whole create
  // if a site insert fails (the customer already exists at this point —
  // the operator can add sites later from the customer page).
  const candidates: SiteInputLoose[] = [
    {
      id: opts?.primarySiteId,
      address_line_1: input.address_line_1,
      address_line_2: input.address_line_2,
      town: input.town,
      county: input.county,
      postcode: input.postcode,
    },
    ...additionalSites,
  ].filter(hasUsableSiteAddress);

  if (candidates.length > 0) {
    // upsert for the same reason as the customer above: a lost-ack
    // replay re-runs with the SAME client site ids — idempotent
    // overwrite instead of a duplicate-key error.
    const { error: sitesError } = await supabase
      .from("sites")
      .upsert(candidates.map((s) => siteRow(data.id, s)));
    if (sitesError) {
      console.error(
        "[createCustomer] auto-site insert failed (customer was created):",
        sitesError.code,
        sitesError.message
      );
      // Don't throw — customer is saved; operator can add the site later.
    }
  }

  return data;
}

/**
 * Toggle the Google review-received flag on a customer.
 * Used by the customer list / side panel checkbox.
 */
export async function setGoogleReviewReceived(
  customerId: string,
  received: boolean
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ google_review_received: received })
    .eq("id", customerId);

  if (error) {
    console.error("[setGoogleReviewReceived]", error.code, error.message);
    throw new Error(`Failed to update review status: ${error.message}`);
  }
}

/**
 * Soft-delete a customer.
 *
 * Sets `deleted_at = now()`. The RLS SELECT policy on `customers`
 * filters `deleted_at IS NULL`, so the row immediately disappears
 * from every read across the app — list views, detail panels,
 * dashboards, calendar joins, the lot.
 *
 * The customer's child rows (sites, jobs, agreements, invoices, tasks,
 * reports) are NOT touched. Hard-delete cascades used to remove them
 * automatically; with soft delete that's no longer the case. They'll
 * still effectively disappear from list views because most read
 * queries inner-join through customers/sites and RLS hides the parent
 * — see the "Inner-join visibility cascade" item in
 * POST_OFFLINE_FOLLOWUPS.md for the long-term refactor.
 *
 * Storage objects (signatures, photos, PDFs in the "reports" bucket)
 * are untouched — they're keyed by uuid in the path and harmless once
 * the parent row is hidden.
 *
 * Goes through the soft_delete_customer SECURITY DEFINER RPC
 * (migration 032), NOT a direct `.update()`: the SELECT policy's
 * `USING (deleted_at IS NULL)` is enforced against the post-update row,
 * so the very update that sets deleted_at is rejected with 42501 for
 * every authenticated user. The RPC is the narrowest bypass — read
 * policies stay untouched, deleted rows stay hidden.
 */
export async function deleteCustomer(customerId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_customer", {
    p_id: customerId,
  });
  if (error) {
    console.error("[deleteCustomer]", error.code, error.message);
    throw new Error(`Failed to soft-delete customer: ${error.message}`);
  }
}

/**
 * Count of related rows that will effectively disappear when the
 * customer is soft-deleted. The child rows themselves stay in the DB
 * (no cascade with soft delete), but they're inner-joined through the
 * customer in most list queries — and RLS now filters the soft-deleted
 * customer out of those joins — so the child rows become hidden from
 * normal app views.
 *
 * Surfaced to the user in the delete-confirmation dialog so they
 * understand what's about to disappear. The UI wording should reflect
 * "will become hidden" rather than "will be deleted"; tracking that as
 * a UI follow-up in POST_OFFLINE_FOLLOWUPS.md.
 */
export interface DeleteImpact {
  sites: number;
  jobs: number;
  agreements: number;
  invoices: number;
}

export async function getDeleteImpact(
  customerId: string
): Promise<DeleteImpact> {
  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("id")
    .eq("customer_id", customerId);
  const siteIds = (sites ?? []).map((s) => s.id);

  let jobs = 0;
  if (siteIds.length > 0) {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("site_id", siteIds);
    jobs = count ?? 0;
  }

  const { count: agreementsCount } = await supabase
    .from("agreements")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  const { count: invoicesCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  return {
    sites: siteIds.length,
    jobs,
    agreements: agreementsCount ?? 0,
    invoices: invoicesCount ?? 0,
  };
}

/**
 * L3: set a customer's email address (the inline "Add email" affordance
 * on the service-sheet flow). Normalised lowercase/trimmed; format is
 * validated in the action layer.
 */
export async function updateCustomerEmail(
  customerId: string,
  email: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ email: email.trim().toLowerCase() })
    .eq("id", customerId);

  if (error) {
    console.error("[updateCustomerEmail]", error.code, error.message);
    throw new Error(`Failed to update customer email: ${error.message}`);
  }
}

/**
 * Update a customer's commercial/domestic classification.
 */
export async function updateCustomerType(
  customerId: string,
  type: CustomerType
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ customer_type: type })
    .eq("id", customerId);

  if (error) {
    console.error("[updateCustomerType]", error.code, error.message);
    throw new Error(`Failed to update customer type: ${error.message}`);
  }
}

// ─── Aggregated list for the Customers page ──────────────────────────────

export interface CustomerListItem extends Customer {
  jobCount: number;
  serviceSheetCount: number;
  /**
   * Invoice count for this customer. `null` when the count is
   * unavailable — this happens offline on the converted list page
   * because the `invoices` table is not synced to Dexie (offline-pwa
   * Gap A → Option A; same precedent as `reports`). The
   * `CustomersTable` renders "—" for null. The server-side
   * `getCustomerListItems` always returns an actual number.
   */
  invoiceCount: number | null;
  primarySite: Site | null;
  latestJobCallType: string | null;
  upcomingJob: { id: string; job_date: string; site_id: string } | null;
  hasActiveAgreement: boolean;
}

interface ListOptions {
  type?: CustomerType | "all";
  search?: string;
  limit?: number;
}

/**
 * Customers + aggregate columns (job counts, primary site, upcoming visit,
 * agreement status) for the list page.
 *
 * Strategy: pull the customer slice, then 3 batched join queries (sites,
 * jobs, agreements) and stitch in JS. Keeps RLS simple, avoids needing a
 * Postgres view, and is plenty fast at the scale this CRM runs at (<10k
 * customers).
 */
export async function getCustomerListItems(
  options: ListOptions = {}
): Promise<CustomerListItem[]> {
  const { type = "all", search, limit = 200 } = options;
  const supabase = await createClient();

  let q = supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (type !== "all") {
    q = q.eq("customer_type", type);
  }
  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim()}%`;
    q = q.or(`name.ilike.${pattern},company_name.ilike.${pattern}`);
  }

  const { data: customers, error } = await q;
  if (error) {
    console.error("[getCustomerListItems]", error.code, error.message);
    throw new Error(`Failed to fetch customers: ${error.message}`);
  }
  if (!customers || customers.length === 0) return [];

  const customerIds = customers.map((c) => c.id);

  // Sites — one query, group by customer in JS.
  const { data: sites } = await supabase
    .from("sites")
    .select("*")
    .in("customer_id", customerIds)
    .order("created_at", { ascending: true });

  const sitesByCustomer = new Map<string, Site[]>();
  const siteToCustomer = new Map<string, string>();
  for (const s of sites ?? []) {
    siteToCustomer.set(s.id, s.customer_id);
    const list = sitesByCustomer.get(s.customer_id) ?? [];
    list.push(s as Site);
    sitesByCustomer.set(s.customer_id, list);
  }

  // Jobs — across all of these customers' sites.
  const siteIds = (sites ?? []).map((s) => s.id);
  let jobs: Job[] = [];
  if (siteIds.length > 0) {
    const { data } = await supabase
      .from("jobs")
      .select("id, site_id, job_date, job_status, call_type")
      .in("site_id", siteIds)
      .eq("is_archived", false)
      .order("job_date", { ascending: true });
    jobs = (data ?? []) as Job[];
  }

  const jobsByCustomer = new Map<string, Job[]>();
  for (const j of jobs) {
    const cid = siteToCustomer.get(j.site_id);
    if (!cid) continue;
    const list = jobsByCustomer.get(cid) ?? [];
    list.push(j);
    jobsByCustomer.set(cid, list);
  }

  // Active agreements per customer.
  let agreements: Agreement[] = [];
  {
    const { data } = await supabase
      .from("agreements")
      .select("id, customer_id, status")
      .in("customer_id", customerIds)
      .eq("status", "active");
    agreements = (data ?? []) as Agreement[];
  }
  const activeAgreementCustomers = new Set(agreements.map((a) => a.customer_id));

  // Invoice counts per customer
  const invoiceCountsMap = new Map<string, number>();
  {
    const { data } = await supabase
      .from("invoices")
      .select("customer_id")
      .in("customer_id", customerIds);
    for (const row of data ?? []) {
      invoiceCountsMap.set(
        row.customer_id,
        (invoiceCountsMap.get(row.customer_id) ?? 0) + 1
      );
    }
  }

  const today = todayUk();

  return customers.map((c) => {
    const cSites = sitesByCustomer.get(c.id) ?? [];
    const cJobs = jobsByCustomer.get(c.id) ?? [];
    const completed = cJobs.filter((j) => j.job_status === "completed");
    const upcoming = cJobs
      .filter((j) => j.job_date >= today && j.job_status !== "completed")
      .sort((a, b) => a.job_date.localeCompare(b.job_date))[0];
    // Latest job call type (by date, most recent regardless of status)
    const latestJob = [...cJobs].sort((a, b) =>
      b.job_date.localeCompare(a.job_date)
    )[0];

    return {
      ...c,
      jobCount: cJobs.length,
      serviceSheetCount: completed.length,
      invoiceCount: invoiceCountsMap.get(c.id) ?? 0,
      primarySite: cSites[0] ?? null,
      latestJobCallType: latestJob?.call_type ?? null,
      upcomingJob: upcoming
        ? {
            id: upcoming.id,
            job_date: upcoming.job_date,
            site_id: upcoming.site_id,
          }
        : null,
      hasActiveAgreement: activeAgreementCustomers.has(c.id),
    };
  });
}

// ─── Detailed view (for the side panel) ──────────────────────────────────

export interface CustomerDetail {
  customer: Customer;
  sites: Site[];
  pastJobs: Array<{
    id: string;
    job_date: string;
    job_status: string;
    call_type: string | null;
    site_id: string;
    reference_number: string | null;
    parent_job_id: string | null;
    pest_species: string[] | null;
    report_notes: string | null;
  }>;
  upcomingJobs: Array<{
    id: string;
    job_date: string;
    job_status: string;
    call_type: string | null;
    site_id: string;
    reference_number: string | null;
    parent_job_id: string | null;
    pest_species: string[] | null;
    report_notes: string | null;
  }>;
  agreements: Array<{
    id: string;
    contract_pdf_url: string | null;
    status: string;
    end_date: string | null;
    reference_number: string | null;
  }>;
  reports: Array<{
    id: string;
    job_id: string;
    pdf_url: string | null;
    created_at: string;
  }>;
  pendingTasks: Array<{
    id: string;
    title: string;
    task_type: string;
    due_date: string | null;
    priority: string;
  }>;
}

/**
 * One-shot fetch of everything the customer side-panel needs.
 * Returns null if the customer doesn't exist.
 */
export async function getCustomerDetail(
  customerId: string
): Promise<CustomerDetail | null> {
  const supabase = await createClient();

  const { data: customer, error: cErr } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();
  if (cErr) {
    if (cErr.code === "PGRST116") return null;
    console.error("[getCustomerDetail]", cErr.code, cErr.message);
    throw new Error(`Failed to fetch customer: ${cErr.message}`);
  }

  const { data: sites } = await supabase
    .from("sites")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  const siteIds = (sites ?? []).map((s) => s.id);

  // Jobs across all of this customer's sites
  let jobsData: CustomerDetail["pastJobs"] = [];
  if (siteIds.length > 0) {
    const { data } = await supabase
      .from("jobs")
      .select(
        "id, job_date, job_status, call_type, site_id, reference_number, parent_job_id, pest_species, report_notes"
      )
      .in("site_id", siteIds)
      .eq("is_archived", false)
      .order("job_date", { ascending: false });
    jobsData = (data ?? []) as CustomerDetail["pastJobs"];
  }

  const today = todayUk();
  const upcomingJobs = jobsData
    .filter((j) => j.job_date >= today && j.job_status !== "completed")
    .sort((a, b) => a.job_date.localeCompare(b.job_date));
  const pastJobs = jobsData
    .filter((j) => !upcomingJobs.find((u) => u.id === j.id))
    .slice(0, 15);

  // Agreements
  const { data: agreements } = await supabase
    .from("agreements")
    .select("id, contract_pdf_url, status, end_date, reference_number")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  // Reports (service report PDFs) for this customer's jobs
  let reports: Array<{
    id: string;
    job_id: string;
    pdf_url: string | null;
    created_at: string;
  }> = [];
  if (jobsData.length > 0) {
    const { data } = await supabase
      .from("reports")
      .select("id, job_id, pdf_url, created_at")
      .in(
        "job_id",
        jobsData.map((j) => j.id)
      )
      .not("pdf_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    reports = data ?? [];
  }

  // Pending tasks for this customer
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, task_type, due_date, priority")
    .eq("related_customer_id", customerId)
    .eq("status", "pending")
    .order("priority_order", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false });

  return {
    customer: customer as Customer,
    sites: (sites ?? []) as Site[],
    pastJobs,
    upcomingJobs,
    agreements: (agreements ?? []) as CustomerDetail["agreements"],
    reports,
    pendingTasks: (tasks ?? []) as CustomerDetail["pendingTasks"],
  };
}

export async function getRecentCustomers(
  limit: number = 5
): Promise<Customer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[getRecentCustomers]", error.code, error.message);
    throw new Error(`Failed to fetch recent customers: ${error.message}`);
  }

  return data;
}

export async function searchCustomers(
  query: string,
  options: PaginationOptions = {}
): Promise<Customer[]> {
  const { limit = 50, offset = 0 } = options;
  const supabase = await createClient();
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .or(`name.ilike.${pattern},company_name.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[searchCustomers]", error.code, error.message);
    throw new Error(`Failed to search customers: ${error.message}`);
  }

  return data;
}
