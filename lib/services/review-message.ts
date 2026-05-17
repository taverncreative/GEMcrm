import type { Customer, Job } from "@/types/database";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { sendEmail as sendEmailViaResend } from "@/lib/services/email";
import { BUSINESS } from "@/lib/constants/branding";

interface MessageResult {
  to: string;
  body: string;
}

/**
 * Generate an SMS message body for a review request.
 * The send path itself is still a stub — Twilio/MessageBird hasn't been
 * wired yet. When you're ready to enable SMS, swap the body of `sendSMS`
 * for a real provider call and add `TWILIO_*` env vars.
 */
export function generateSMS(
  customer: Customer,
  job: Job
): MessageResult | null {
  if (!customer.phone) return null;

  const serviceType = job.call_type
    ? CALL_TYPE_LABELS[job.call_type] ?? job.call_type
    : "pest control service";

  const body = [
    `Hi ${customer.name},`,
    `Thank you for choosing ${BUSINESS.name} for your recent ${serviceType}.`,
    `We'd really appreciate it if you could leave us a quick review:`,
    BUSINESS.reviewUrl,
    `Thanks, ${BUSINESS.name}`,
  ].join("\n");

  return { to: customer.phone, body };
}

/**
 * Build the email body for a review request — used by the auto-send
 * pipeline (`processDomesticReviewSends`). The customer-facing button in
 * the Review Requests widget uses `mailto:` with `buildReviewEmail` from
 * `review-email.ts` instead.
 */
export function generateEmail(
  customer: Customer,
  job: Job
): { to: string; subject: string; body: string } | null {
  if (!customer.email) return null;

  const serviceType = job.call_type
    ? CALL_TYPE_LABELS[job.call_type] ?? job.call_type
    : "pest control service";

  const jobDate = new Date(job.job_date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const subject = `How was your recent service? — ${BUSINESS.name}`;

  const body = [
    `Dear ${customer.name},`,
    ``,
    `Thank you for choosing ${BUSINESS.name} for your ${serviceType} on ${jobDate}.`,
    ``,
    `We hope everything met your expectations. If you have a moment, we'd be grateful if you could share your experience:`,
    ``,
    BUSINESS.reviewUrl,
    ``,
    `Your feedback helps us improve and helps other customers find reliable pest control.`,
    ``,
    `Kind regards,`,
    BUSINESS.name,
  ].join("\n");

  return { to: customer.email, subject, body };
}

/**
 * SMS stub. No-op until a provider is wired. Kept as an `async` Promise so
 * call sites can `await` it unchanged when SMS is enabled.
 */
export async function sendSMS(message: MessageResult): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log("[sms:stub] to:", message.to);
  }
  // TODO: Wire Twilio (or MessageBird) here.
  // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await client.messages.create({ to: message.to, body: message.body, from: process.env.TWILIO_FROM });
}

/**
 * Send a review-request email. Real send via Resend (see `email.ts`).
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  await sendEmailViaResend({
    to: message.to,
    subject: message.subject,
    text: message.body,
  });
}
