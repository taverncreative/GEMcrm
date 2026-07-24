import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PrintOrder, PrintOrderItem } from "@/types/database";

/**
 * Data layer for confirmed print orders (migration 048) — the light local
 * record of each basket sent to Spotlight. `id` is the client-generated
 * order id (Spotlight's idempotency key), so a second create with the same
 * id is a conflict-free retry rather than a duplicate.
 */

export async function createPrintOrder(input: {
  id: string;
  items: PrintOrderItem[];
  submitter?: string | null;
  note?: string | null;
}): Promise<PrintOrder> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("print_orders")
    // upsert(onConflict:id) so a re-submit with the same order id (the
    // idempotency key) re-runs cleanly instead of erroring on the PK.
    .upsert(
      {
        id: input.id,
        submitter: input.submitter ?? null,
        note: input.note ?? null,
        item_count: input.items.length,
        items: input.items,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[createPrintOrder]", error.code, error.message);
    throw new Error(`Failed to record print order: ${error.message}`);
  }
  return data;
}

/**
 * Record the outcome of the fire-and-forget Spotlight POST. Runs inside
 * after() — the response is already sent — so it uses the ADMIN client
 * (service role, no cookies) rather than the request-scoped server client,
 * which avoids any reliance on the auth context still being available
 * post-response. Best-effort: a failure to record the outcome is logged and
 * swallowed (the order row itself already exists).
 */
export async function markPrintOrderDelivered(
  id: string,
  delivered: boolean,
  reason?: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("print_orders")
      .update({ delivered, delivery_reason: reason ?? null })
      .eq("id", id);
    if (error) {
      console.error("[markPrintOrderDelivered]", error.code, error.message);
    }
  } catch (err) {
    console.error("[markPrintOrderDelivered]", err);
  }
}
