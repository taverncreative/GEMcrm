import { createClient } from "@/lib/supabase/server";
import type { Customer } from "@/types/database";

const BASE_PAD = 5;

/**
 * 3-letter company code derived from company_name (or customer name as
 * fallback). Used as a suffix for commercial customers: e.g. 00001-BSK.
 * Padded with X so the format is always 3 chars.
 */
export function customerCode(customer: Pick<Customer, "company_name" | "name">): string {
  const source = (customer.company_name ?? customer.name).trim();
  const letters = source.replace(/[^a-zA-Z]/g, "");
  return letters.slice(0, 3).toUpperCase().padEnd(3, "X");
}

/**
 * Pluck the leading 5-digit number from any job reference, regardless of
 * suffix style. `00001-BSK` → 1, `00001-BSK-2` → 1, `00001` → 1.
 */
function parseBase(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const m = ref.match(/^(\d{1,})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the next "base" number string (e.g. "00037") by scanning the
 * highest existing reference. Pads to 5 digits. Note: not strictly race-safe
 * under concurrent inserts, but at single-operator CRM scale that's fine,
 * and we don't enforce uniqueness at the DB layer for refs (to keep
 * follow-up suffixes flexible).
 */
async function nextBaseNumber(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("reference_number")
    .not("reference_number", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  let max = 0;
  for (const row of data ?? []) {
    const n = parseBase(row.reference_number);
    if (n && n > max) max = n;
  }
  return String(max + 1).padStart(BASE_PAD, "0");
}

/**
 * Count how many follow-ups already exist for a given parent job, so the
 * Nth follow-up gets the `-N` suffix appended.
 */
async function countFollowUps(parentJobId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("parent_job_id", parentJobId);
  return count ?? 0;
}

/**
 * Compute the reference for a new job.
 *
 *   - Top-level booking, domestic:    00037
 *   - Top-level booking, commercial:  00037-BSK
 *   - Follow-up of an existing job:   <parent ref>-N   (N = next follow-up index)
 *
 * If the parent doesn't have a reference (e.g. old data), we synthesise a
 * fresh one as if it were a top-level booking — never leaves a job without
 * a reference.
 */
export async function generateJobReference(input: {
  customer: Pick<Customer, "customer_type" | "company_name" | "name">;
  parentJobId?: string | null;
}): Promise<string> {
  if (input.parentJobId) {
    const supabase = await createClient();
    const { data: parent } = await supabase
      .from("jobs")
      .select("reference_number")
      .eq("id", input.parentJobId)
      .maybeSingle();

    if (parent?.reference_number) {
      const n = await countFollowUps(input.parentJobId);
      return `${parent.reference_number}-${n + 1}`;
    }
  }

  const base = await nextBaseNumber();
  if (input.customer.customer_type === "commercial") {
    return `${base}-${customerCode(input.customer)}`;
  }
  return base;
}
