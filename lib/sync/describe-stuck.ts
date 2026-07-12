import type { OutboxEntry } from "@/lib/db";

/**
 * Operator-facing description of a stuck outbox entry (H3).
 *
 * The alert must read in the operator's terms — "Booking for Jane on
 * 14 Jul didn't reach the server" — never developer jargon like
 * "createQuickBookingAction failed". Pure and offline-safe: reads only
 * the entry's own queued args, no Dexie, no network. New-customer quick
 * adds carry `customer_name` in their replay args, so the common
 * data-loss case (a booking that silently didn't sync) is named fully.
 */

const FRIENDLY: Record<string, string> = {
  createQuickBookingAction: "Booking",
  completeServiceSheetAction: "Service sheet",
  createCustomerAction: "New customer",
  updateJobStatusAction: "Job status change",
  updateAgreementStatusAction: "Agreement status change",
  completeTaskAction: "Task completion",
  setCustomerTypeAction: "Customer update",
  setCustomerEmailAction: "Customer update",
  setCustomerDocDetailsAction: "Customer details update",
  setReviewReceivedAction: "Review flag",
};

function fmtDate(d: string): string {
  const t = Date.parse(d);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function describeStuckEntry(entry: OutboxEntry): string {
  const args =
    entry.args && typeof entry.args === "object"
      ? (entry.args as Record<string, unknown>)
      : {};
  const s = (k: string) =>
    typeof args[k] === "string" ? (args[k] as string).trim() : "";

  if (entry.action_name === "createQuickBookingAction") {
    const who = s("customer_name");
    const when = fmtDate(s("job_date"));
    return `Booking${who ? ` for ${who}` : ""}${
      when ? ` on ${when}` : ""
    } didn't reach the server`;
  }

  if (entry.action_name === "completeServiceSheetAction") {
    const who = s("client_name") || s("customer_name");
    return `Service sheet${
      who ? ` for ${who}` : ""
    } didn't reach the server`;
  }

  if (entry.action_name === "createCustomerAction") {
    const who = s("name") || s("customer_name");
    return `New customer${who ? ` ${who}` : ""} didn't reach the server`;
  }

  const friendly = FRIENDLY[entry.action_name] ?? "A change you made";
  return `${friendly} didn't reach the server`;
}
