import { getExpiringAgreements } from "@/lib/data/agreements";
import { createTask, hasPendingTaskForAgreement } from "@/lib/data/tasks";

/**
 * Standalone renewal check — no UI dependency.
 * Scans agreements expiring within 30 days and creates
 * contract_renewal tasks where none already exist for that agreement.
 *
 * Idempotent: safe to call from cron, API route, or manually.
 * Returns the number of tasks created.
 */
export async function runRenewalCheck(): Promise<number> {
  let created = 0;

  try {
    const expiring = await getExpiringAgreements(30);

    for (const agreement of expiring) {
      const alreadyExists = await hasPendingTaskForAgreement(
        agreement.id,
        "contract_renewal"
      );

      if (alreadyExists) continue;

      const customerName = agreement.customer?.name ?? "Unknown";
      const siteName = agreement.site?.address_line_1 ?? "Unknown site";

      await createTask({
        title: `[Contract Renewal] ${customerName} – ${siteName}`,
        due_date: agreement.end_date,
        task_type: "contract_renewal",
        priority: "high",
        related_customer_id: agreement.customer_id,
        agreement_id: agreement.id,
        site_id: agreement.site_id,
      });

      created++;
    }
  } catch (err) {
    console.error("[runRenewalCheck]", err);
  }

  return created;
}
