/**
 * Outbox — local-first write queue.
 *
 * Every mutation that wants offline support enqueues an entry here AFTER
 * applying its change to the local Dexie store. Step 6's sync engine
 * drains entries when online by re-invoking the named server action
 * with the stored args.
 *
 * The entry stores the action *name* + serialised args, not an HTTP
 * request body — actions are addressed by symbolic name (matching the
 * server action export) so the underlying action implementation can
 * change without breaking in-flight entries. The action signature is
 * the sync contract; the wrapper layer (see `lib/actions/wrap.ts`) is
 * the only place that knows how to invoke an action by name.
 *
 * Step 5 builds the enqueue side. Drain logic is step 6.
 */

import { db } from "@/lib/db";

/** Mutable entity kinds — must match the 5 syncable Dexie tables. */
export type EntityType = "customer" | "site" | "job" | "agreement" | "task";

export interface EnqueueInput {
  /** Server-action export name, e.g. "createCustomerAction". */
  action_name: string;
  /** JSON-serialisable args. For form-action calls we typically pass
   *  a `Record<string, string>` derived from FormData. */
  args: unknown;
  entity_type: EntityType;
  /** UUID of the entity the action targets. Used for dedup +
   *  conflict detection in step 6. */
  entity_id: string;
}

/**
 * Add a new entry to the outbox. Returns the auto-generated entry id
 * (caller can use it to delete the entry once the server confirms the
 * change landed — the online-fast-path in the wrapper does this).
 */
export async function enqueueAction(input: EnqueueInput): Promise<number> {
  const now = new Date().toISOString();
  const id = await db.outbox.add({
    action_name: input.action_name,
    args: input.args,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    created_at: now,
    attempts: 0,
    last_error: null,
    // Sync engine reads this — set to "now" so the first drain attempt
    // is immediate. Step 6's retry logic bumps it forward on failure.
    next_attempt_at: now,
  });
  return id as number;
}

/**
 * Remove an outbox entry. Called by the online-fast-path in the wrapper
 * when the server action succeeds — the entry's purpose was just to
 * survive a mid-call crash, so once we know the server has the change
 * we can drop it.
 */
export async function removeOutboxEntry(id: number): Promise<void> {
  await db.outbox.delete(id);
}
