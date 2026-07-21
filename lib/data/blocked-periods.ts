import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";
import type { BlockedPeriod } from "@/types/database";

interface SaveBlockedPeriodInput {
  /** Client-generated UUID from the offline-first path (applyLocal wrote
   *  this id locally; the outbox replay passes it so server == local).
   *  Omitted → a fresh UUID is minted (behaves like an insert). */
  id?: string;
  start_date: string;
  end_date: string;
  title: string;
}

/**
 * Block-out periods overlapping a date range (inclusive), for the
 * server-rendered calendar. A period [start_date, end_date] overlaps the
 * grid window [rangeStart, rangeEnd] iff start_date <= rangeEnd AND
 * end_date >= rangeStart. Soft-deleted rows are filtered by the SELECT RLS
 * policy (deleted_at IS NULL), same as getJobsInRange.
 */
export async function getBlockedPeriodsInRange(
  rangeStart: string,
  rangeEnd: string
): Promise<BlockedPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blocked_periods")
    .select("*")
    .lte("start_date", rangeEnd)
    .gte("end_date", rangeStart)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("[getBlockedPeriodsInRange]", error.code, error.message);
    return [];
  }

  return data ?? [];
}

/**
 * All non-deleted block-out periods ending today or later, for a
 * management list. Ordered soonest-first.
 */
export async function getUpcomingBlockedPeriods(
  fromDate: string
): Promise<BlockedPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blocked_periods")
    .select("*")
    .gte("end_date", fromDate)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("[getUpcomingBlockedPeriods]", error.code, error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Create or update a block-out period.
 *
 * upsert(onConflict:"id") makes a lost-ack outbox replay idempotent (same
 * client id → no duplicate row) AND doubles as the edit path (an existing
 * id updates in place). Plain server callers omit `id` → a fresh UUID, so
 * no conflict is possible and it behaves like an insert. Mirrors createTask.
 *
 * `created_by` is intentionally omitted: the column DEFAULTs to auth.uid()
 * on insert, and an edit must not overwrite the original author.
 */
export async function saveBlockedPeriod(
  input: SaveBlockedPeriodInput
): Promise<BlockedPeriod> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("blocked_periods")
    .upsert(
      {
        id: input.id ?? newId(),
        start_date: input.start_date,
        end_date: input.end_date,
        title: input.title,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[saveBlockedPeriod]", error.code, error.message);
    throw new Error(`Failed to save block-out period: ${error.message}`);
  }

  return data;
}

/**
 * Soft-delete a block-out period — sets `deleted_at = now()` via the
 * soft_delete_blocked_period SECURITY DEFINER RPC (migration 046), NOT a
 * direct `.update()`: the SELECT policy's `USING (deleted_at IS NULL)`
 * (mirroring 029) rejects the self-hiding update with 42501, exactly like
 * jobs/customers. The RPC is the narrowest bypass. Idempotent.
 */
export async function deleteBlockedPeriod(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_blocked_period", {
    p_id: id,
  });
  if (error) {
    console.error("[deleteBlockedPeriod]", error.code, error.message);
    throw new Error(`Failed to delete block-out period: ${error.message}`);
  }
}
