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
 * Queue compaction (added in step 6 commit 5)
 * --------------------------------------------
 * Before adding a new entry, `enqueueAction` inspects prior non-stuck
 * entries on the same `(entity_type, entity_id)` and applies these
 * rules:
 *
 *   - prior=update, new=update → drop prior, keep new (latest payload
 *     replaces). Saves N redundant calls when a user toggles a value
 *     N times offline.
 *
 *   - prior=update, new=delete → drop prior, keep new. The server
 *     never needs to see the intermediate update.
 *
 *   - prior=create, new=delete → drop both, return without enqueue.
 *     The row never existed server-side and we're cancelling locally
 *     too — no work for the server to do.
 *
 *   - prior=create, new=update → KEEP both. The create's payload is
 *     what brings the row into being; the update's payload mutates
 *     it. Merging payloads would require per-action knowledge the
 *     outbox doesn't have — replay in order is correct.
 *     (Partial-implementation note: the user-spec "single create
 *     with merged payload" is deferred until wrappers can supply a
 *     merge callback. Tracked in STEP_6_NOTES.md.)
 *
 *   - any other combination → KEEP both (defensive: ordering may
 *     matter, replay sequence handles it).
 *
 * Compaction inspects only entries with the same entity_id AND that
 * aren't `stuck` — stuck entries are quarantined for the conflict
 * inbox and shouldn't be folded into anything new.
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
  /** Op kind — drives compaction folding rules. Optional; defaults
   *  to "update" which is the conservative choice (compaction keeps
   *  latest update, never silently cancels work). Wrappers for
   *  create-shape and delete-shape actions should pass explicitly. */
  op?: "create" | "update" | "delete";
  /** Secondary entity ids touched by a multi-entity action. See
   *  `OutboxEntry.entity_ids` for the full rationale. Wrappers for
   *  multi-entity actions like `createAgreementAction` should populate
   *  this with the child-row ids the action writes. */
  entity_ids?: string[];
}

export interface EnqueueResult {
  /** Auto-incremented id of the new entry, or null if compaction
   *  cancelled both prior and new (the "create+delete = no-op" case). */
  id: number | null;
  /** Outbox ids dropped by compaction. Useful for diagnostics + the
   *  smoke page's "what just happened" panel. */
  compacted_ids: number[];
}

/**
 * Add a new entry to the outbox with compaction.
 *
 * Returns `EnqueueResult` with the new id (or null if the entry was
 * fully cancelled by compaction) and the list of prior entry ids
 * that were removed in the process.
 */
export async function enqueueAction(input: EnqueueInput): Promise<EnqueueResult> {
  const op = input.op ?? "update";
  const compacted_ids: number[] = [];

  // Find prior non-stuck entries for the same entity. Sorted by
  // created_at ASC so the last item is the most recent — that's the
  // one whose op we examine for the compaction rule.
  const prior = (
    await db.outbox
      .where("[entity_type+entity_id]")
      .equals([input.entity_type, input.entity_id])
      .sortBy("created_at")
  ).filter((e) => !e.stuck);

  if (prior.length > 0) {
    const latest = prior[prior.length - 1];
    const latestOp = latest.op ?? "update";

    // Rule: create + delete → no-op (drop both, don't enqueue)
    if (latestOp === "create" && op === "delete") {
      await db.outbox.delete(latest.id!);
      compacted_ids.push(latest.id!);
      return { id: null, compacted_ids };
    }

    // Rule: update + update → drop the prior update
    // Rule: update + delete → drop the prior update
    if (latestOp === "update" && (op === "update" || op === "delete")) {
      await db.outbox.delete(latest.id!);
      compacted_ids.push(latest.id!);
    }

    // create + update → keep both (no merge support yet). Fall through.
    // anything else → keep both. Fall through.
  }

  const now = new Date().toISOString();
  const id = await db.outbox.add({
    action_name: input.action_name,
    args: input.args,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    created_at: now,
    attempts: 0,
    last_error: null,
    next_attempt_at: now,
    stuck: false,
    op,
    ...(input.entity_ids ? { entity_ids: input.entity_ids } : {}),
  });

  return { id: id as number, compacted_ids };
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
