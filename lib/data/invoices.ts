import { createClient } from "@/lib/supabase/server";
import { todayUk, dateUkOffset } from "@/lib/utils/today-uk";
import type { Invoice, Customer } from "@/types/database";

/**
 * Generate a human-readable invoice number.
 * Format: INV-{YYYY}-{4-digit-padded-counter}.
 *
 * Strategy: read the highest existing invoice_number, parse its suffix and
 * increment. Not strictly race-safe under concurrent inserts but fine for
 * single-operator CRM scale; the DB-level unique index on invoice_number
 * will reject any duplicate that does slip through.
 */
async function nextInvoiceNumber(): Promise<string> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("invoices")
    .select("invoice_number")
    .not("invoice_number", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const match = row?.invoice_number?.match(/-(\d+)$/);
  const counter = match ? Number(match[1]) + 1 : 1001;
  const year = new Date().getFullYear();
  return `INV-${year}-${String(counter).padStart(4, "0")}`;
}

/**
 * Create an invoice for a completed job.
 * Marks the job as invoiced.
 */
export async function createInvoiceForJob(
  jobId: string,
  customerId: string,
  amount: number
): Promise<Invoice> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      job_id: jobId,
      customer_id: customerId,
      amount,
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    console.error("[createInvoiceForJob]", error.code, error.message);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }

  // Mark job as invoiced
  const { error: jobErr } = await supabase
    .from("jobs")
    .update({ is_invoiced: true })
    .eq("id", jobId);

  if (jobErr) {
    console.error("[createInvoiceForJob] job update failed:", jobErr.message);
  }

  return data;
}

/**
 * Mark an invoice as sent.
 */
export async function markInvoiceSent(invoiceId: string): Promise<Invoice> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "sent", issued_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .select()
    .single();

  if (error) {
    console.error("[markInvoiceSent]", error.code, error.message);
    throw new Error(`Failed to mark invoice sent: ${error.message}`);
  }

  return data;
}

/**
 * Mark an invoice as paid. Also marks the linked job as paid.
 */
export async function markInvoicePaid(invoiceId: string): Promise<Invoice> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .select()
    .single();

  if (error) {
    console.error("[markInvoicePaid]", error.code, error.message);
    throw new Error(`Failed to mark invoice paid: ${error.message}`);
  }

  // Mark linked job as paid
  if (data.job_id) {
    const { error: jobErr } = await supabase
      .from("jobs")
      .update({ is_paid: true })
      .eq("id", data.job_id);

    if (jobErr) {
      console.error("[markInvoicePaid] job update failed:", jobErr.message);
    }
  }

  return data;
}

/**
 * Get invoice by job ID.
 */
export async function getInvoiceByJobId(
  jobId: string
): Promise<Invoice | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    console.error("[getInvoiceByJobId]", error.code, error.message);
    return null;
  }

  return data;
}

/**
 * Standalone invoice creation — does not require a job.
 *
 * Stores VAT broken out (subtotal / vat / total) so the PDF can render a
 * proper breakdown and reports can sum either net or gross figures.
 *
 * Invoice number: when invoicing a job, the invoice adopts the job's
 * reference_number (e.g. 00037-BSK). Standalone invoices fall back to
 * INV-YYYY-NNNN.
 */
export interface StandaloneInvoiceInput {
  customer_id: string;
  job_id?: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  vat_rate: number;
  description?: string;
  due_date?: string | null;
  status?: "draft" | "sent";
}

export async function createStandaloneInvoice(
  input: StandaloneInvoiceInput
): Promise<Invoice> {
  const supabase = await createClient();

  // Reuse the job's reference as the invoice number when invoicing a job.
  // If the job pre-dates migration 021 and is still missing a reference,
  // generate one now via the same scheme used for new bookings, save it
  // back to the job row, and use it. This guarantees we never fall through
  // to a raw UUID stub like "77500CEF".
  let invoiceNumber: string | null = null;
  if (input.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("reference_number, site_id")
      .eq("id", input.job_id)
      .maybeSingle();
    if (job?.reference_number) {
      invoiceNumber = job.reference_number;
    } else if (job) {
      // Look up the customer via the site so generateJobReference can pick
      // the right format (domestic vs commercial with company suffix).
      const { data: siteRow } = await supabase
        .from("sites")
        .select("customer:customers!inner(customer_type, company_name, name)")
        .eq("id", job.site_id)
        .single();
      const customer = (
        siteRow as unknown as {
          customer: {
            customer_type: "commercial" | "domestic";
            company_name: string | null;
            name: string;
          };
        } | null
      )?.customer;
      if (customer) {
        const { generateJobReference } = await import(
          "@/lib/data/job-references"
        );
        const newRef = await generateJobReference({ customer });
        await supabase
          .from("jobs")
          .update({ reference_number: newRef })
          .eq("id", input.job_id);
        invoiceNumber = newRef;
      }
    }
  }
  if (!invoiceNumber) {
    invoiceNumber = await nextInvoiceNumber();
  }

  const issuedAt = input.status === "sent" ? new Date().toISOString() : null;
  const dueDate = input.due_date ?? dateUkOffset(30);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: input.customer_id,
      job_id: input.job_id ?? null,
      amount: input.total,
      subtotal_amount: input.subtotal,
      vat_amount: input.vat_amount,
      vat_rate: input.vat_rate,
      description: input.description?.trim() || null,
      due_date: dueDate,
      invoice_number: invoiceNumber,
      status: input.status ?? "draft",
      issued_at: issuedAt,
    })
    .select()
    .single();

  if (error) {
    console.error("[createStandaloneInvoice]", error.code, error.message);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }

  if (input.job_id) {
    await supabase
      .from("jobs")
      .update({ is_invoiced: true })
      .eq("id", input.job_id);
  }

  return data;
}

/**
 * Save a generated PDF URL onto an existing invoice.
 */
export async function setInvoicePdfUrl(
  invoiceId: string,
  pdfUrl: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ pdf_url: pdfUrl })
    .eq("id", invoiceId);
  if (error) {
    console.error("[setInvoicePdfUrl]", error.code, error.message);
    throw new Error(`Failed to save invoice PDF URL: ${error.message}`);
  }
}

/**
 * Count of invoices per customer for the customers list column.
 * Returns a map { customer_id → count }.
 */
export async function getInvoiceCountsByCustomer(
  customerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("customer_id")
    .in("customer_id", customerIds);
  if (error) {
    console.error("[getInvoiceCountsByCustomer]", error.code, error.message);
    return counts;
  }
  for (const row of data ?? []) {
    counts.set(row.customer_id, (counts.get(row.customer_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Invoice + the customer + the optional job that produced it. Used by the
 * PDF generator.
 */
export interface InvoiceWithCustomer extends Invoice {
  customer: Customer;
}

export async function getInvoiceWithCustomer(
  id: string
): Promise<InvoiceWithCustomer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, customer:customers!inner(*)")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("[getInvoiceWithCustomer]", error.code, error.message);
    return null;
  }
  return data as unknown as InvoiceWithCustomer;
}

/**
 * Get all unpaid invoices (draft + sent).
 */
export async function getUnpaidInvoices(): Promise<Invoice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .neq("status", "paid")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getUnpaidInvoices]", error.code, error.message);
    throw new Error(`Failed to fetch unpaid invoices: ${error.message}`);
  }

  return data;
}

/**
 * Get invoices for a customer.
 */
export async function getInvoicesByCustomer(
  customerId: string
): Promise<Invoice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getInvoicesByCustomer]", error.code, error.message);
    throw new Error(`Failed to fetch invoices: ${error.message}`);
  }

  return data;
}

export interface RevenueStats {
  revenueToday: number;
  unpaidJobsCount: number;
  unpaidInvoicesTotal: number;
  /** Paid invoices total since 1 Jan of the current year. */
  revenueYtd: number;
  /** YTD paid revenue split by customer type. */
  revenueYtdCommercial: number;
  revenueYtdDomestic: number;
  /** Sum of active PMA contract_value — annual committed commercial revenue. */
  commercialCommittedAnnual: number;
}

/**
 * Dashboard revenue statistics.
 */
export async function getRevenueStats(): Promise<RevenueStats> {
  const supabase = await createClient();
  const today = todayUk();
  // Year boundary in UK time (Jan 1 in the UK, even if server is mid-year UTC).
  const yearStart = `${todayUk().slice(0, 4)}-01-01`;

  // Revenue today: sum of paid invoices where paid_at is today
  const { data: paidToday, error: e1 } = await supabase
    .from("invoices")
    .select("amount")
    .eq("status", "paid")
    .gte("paid_at", `${today}T00:00:00`)
    .lte("paid_at", `${today}T23:59:59`);
  if (e1) console.error("[getRevenueStats] paidToday:", e1.message);
  const revenueToday = (paidToday ?? []).reduce(
    (s, inv) => s + Number(inv.amount),
    0
  );

  // Year-to-date paid invoices with customer type joined in so we can split
  // commercial vs domestic in JS without a second query.
  const { data: paidYtd, error: e2 } = await supabase
    .from("invoices")
    .select("amount, customer:customers!inner(customer_type)")
    .eq("status", "paid")
    .gte("paid_at", `${yearStart}T00:00:00`);
  if (e2) console.error("[getRevenueStats] paidYtd:", e2.message);

  let revenueYtd = 0;
  let revenueYtdCommercial = 0;
  let revenueYtdDomestic = 0;
  for (const row of paidYtd ?? []) {
    const amt = Number(row.amount);
    revenueYtd += amt;
    // PostgREST returns the embedded relation as an array even for 1:1 — pick first.
    const cust = Array.isArray((row as { customer: unknown }).customer)
      ? ((row as unknown as { customer: { customer_type: string }[] }).customer[0] ?? null)
      : ((row as unknown as { customer: { customer_type: string } | null }).customer ?? null);
    if (cust?.customer_type === "commercial") revenueYtdCommercial += amt;
    else if (cust?.customer_type === "domestic") revenueYtdDomestic += amt;
  }

  // Active commercial PMAs — sum of annual contract values gives a forward-
  // looking committed commercial revenue figure.
  const { data: pmaRows, error: e3 } = await supabase
    .from("agreements")
    .select("contract_value, customer:customers!inner(customer_type)")
    .eq("status", "active");
  if (e3) console.error("[getRevenueStats] pmas:", e3.message);

  let commercialCommittedAnnual = 0;
  for (const row of pmaRows ?? []) {
    const cust = Array.isArray((row as { customer: unknown }).customer)
      ? ((row as unknown as { customer: { customer_type: string }[] }).customer[0] ?? null)
      : ((row as unknown as { customer: { customer_type: string } | null }).customer ?? null);
    if (cust?.customer_type === "commercial") {
      commercialCommittedAnnual += Number(row.contract_value ?? 0);
    }
  }

  // Unpaid jobs + unpaid invoices total (unchanged)
  const { count: unpaidJobsCount } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_status", "completed")
    .eq("is_paid", false);

  const { data: unpaidInvs } = await supabase
    .from("invoices")
    .select("amount")
    .neq("status", "paid");

  const unpaidInvoicesTotal = (unpaidInvs ?? []).reduce(
    (s, inv) => s + Number(inv.amount),
    0
  );

  return {
    revenueToday,
    unpaidJobsCount: unpaidJobsCount ?? 0,
    unpaidInvoicesTotal,
    revenueYtd,
    revenueYtdCommercial,
    revenueYtdDomestic,
    commercialCommittedAnnual,
  };
}
