import type { Customer } from "@/types/database";
import { sendEmail } from "@/lib/services/email";
import { BUSINESS } from "@/lib/constants/branding";

/**
 * Google review URL. Sourced from `BUSINESS.reviewUrl` (env-overridable
 * via `REVIEW_LINK_URL`). Re-exported here for backwards-compatibility
 * with anything importing `GEM_REVIEW_URL`.
 */
export const GEM_REVIEW_URL = BUSINESS.reviewUrl;

export interface ReviewEmailDraft {
  to: string;
  subject: string;
  body: string;
}

/**
 * Build the review-request email content. Used both by the `mailto:` button
 * (client) and the auto-send pipeline (server).
 */
export function buildReviewEmail(customer: Customer): ReviewEmailDraft {
  const firstName = customer.name.split(" ")[0] ?? customer.name;
  const subject = `How did we do? — ${BUSINESS.name}`;
  const body = [
    `Hi ${firstName},`,
    "",
    `Thanks again for choosing ${BUSINESS.name} for your recent pest control visit. We hope everything went well.`,
    "",
    "If you have a moment, we'd really appreciate a quick Google review — it makes a huge difference for our small business and helps other customers find us.",
    "",
    `You can leave a review here: ${BUSINESS.reviewUrl}`,
    "",
    "It only takes a minute and we'd be grateful for your feedback.",
    "",
    "Kind regards,",
    BUSINESS.name,
  ].join("\n");

  return { to: customer.email ?? "", subject, body };
}

/**
 * Server-side review send used by the auto pipeline.
 */
export async function sendReviewRequest(
  customer: Customer
): Promise<{ success: boolean; error?: string }> {
  if (!customer.email) {
    return { success: false, error: "Customer has no email" };
  }
  const draft = buildReviewEmail(customer);
  return sendEmail({
    to: draft.to,
    subject: draft.subject,
    text: draft.body,
  });
}
