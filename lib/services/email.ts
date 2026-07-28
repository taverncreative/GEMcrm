/**
 * Email service — single Resend-backed primitive (`sendEmail`) plus a few
 * higher-level helpers for the service-report and agreement templates.
 *
 * Provider behaviour:
 *   - When `RESEND_API_KEY` is set, mail is sent via Resend.
 *   - When it's not (typical dev), we log a one-line summary to console
 *     and return `success: true` so workflows can be exercised without a
 *     Resend account. This keeps onboarding to the project frictionless.
 *
 * Required env (production):
 *   RESEND_API_KEY      — from https://resend.com/api-keys
 *   RESEND_FROM_EMAIL   — verified sender, e.g. "GEM Services <reports@gemservices.uk>"
 *
 * Optional env:
 *   RESEND_REPLY_TO     — Reply-To applied to EVERY send, e.g.
 *                         "nate@gemservices.uk". Lets the From be a
 *                         systematic address (reports@) while customer
 *                         replies still land in a real inbox. Unset means
 *                         no Reply-To header at all, which is the
 *                         pre-existing behaviour and the safe default.
 *   RESEND_BCC          — blind copy on every CUSTOMER-FACING send, e.g.
 *                         "nate@gemservices.uk". Customer mail is addressed
 *                         to the customer, so the operator never saw a copy
 *                         of what went out; this puts one in his inbox
 *                         without the customer seeing the address (BCC, not
 *                         To). Opt-in per sender via `bcc: true` — internal
 *                         mail (feedback, edit requests, developer inbox) is
 *                         already addressed to us and must NOT be copied.
 *                         Unset means no BCC at all: behaviour is exactly as
 *                         it was before.
 *
 * Other email-sending modules in this app (`invoice-email.ts`,
 * `review-message.ts`) delegate to `sendEmail` here, so swapping providers
 * later means changing one file.
 */

import { Resend } from "resend";
import type { Customer } from "@/types/database";
import { BUSINESS } from "@/lib/constants/branding";
import { createAdminClient } from "@/lib/supabase/admin";
import { storageObjectPath } from "@/lib/storage/asset-url";

/**
 * The reports bucket is private (H1), so a customer clicking a PDF link
 * in an email is unauthenticated and can't hit the in-app proxy. Mint a
 * 7-day Supabase signed URL for the object instead. If the reference
 * isn't a reports-bucket object, or signing fails, fall back to the
 * original value (a legacy link — dead when private, logged for
 * visibility). 7 days by design: if it expires, Nate resends.
 */
const EMAIL_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function signedEmailLink(storedUrl: string): Promise<string> {
  const path = storageObjectPath(storedUrl);
  if (!path) return storedUrl;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("reports")
      .createSignedUrl(path, EMAIL_LINK_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      console.error("[signedEmailLink]", error?.message ?? "no signed URL");
      return storedUrl;
    }
    return data.signedUrl;
  } catch (err) {
    console.error("[signedEmailLink]", err);
    return storedUrl;
  }
}

/**
 * Download a reports-bucket PDF so it can be attached to an email.
 * Best-effort by design: any failure (not a storage object, download
 * error, network) returns null and the caller sends link-only — exactly
 * the pre-attachment email. An attachment problem must never fail a
 * send, and in particular must never strand an offline completion
 * replay whose email step is fenced non-fatal.
 */
export async function downloadReportPdf(
  storedUrl: string
): Promise<Buffer | null> {
  const path = storageObjectPath(storedUrl);
  if (!path) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from("reports").download(path);
    if (error || !data) {
      console.error(
        "[downloadReportPdf]",
        error?.message ?? "no data for " + path
      );
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  } catch (err) {
    console.error("[downloadReportPdf]", err);
    return null;
  }
}

/** "23 July 2026" — for attachment filenames. Falls back to the raw
 *  value if the date doesn't parse (never throws over a filename). */
function ukDateForFilename(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface SendEmailInput {
  /** One recipient, or several — all delivered in a single Resend send
   *  (Resend's `to` accepts up to 50 addresses). */
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Override the default sender for one-off cases (e.g. forwarding). */
  from?: string;
  /** Override the default Reply-To for one-off cases. Omit to inherit
   *  RESEND_REPLY_TO (see defaultReplyTo). */
  replyTo?: string | string[];
  /** Opt this send in to the configured RESEND_BCC (see defaultBcc). Set it
   *  on customer-facing mail only; internal mail is already addressed to us. */
  bcc?: boolean;
  /** Resend-style attachments: filename + base64 / Buffer content. */
  attachments?: Array<{ filename: string; content: string | Buffer }>;
}

export interface SendEmailResult {
  success: boolean;
  /** Resend message id on success. */
  id?: string;
  /** Human-readable reason on failure (suitable for logs, not UI). */
  error?: string;
}

// Lazy singleton — initialised on first call so importing this module
// during build doesn't crash if RESEND_API_KEY isn't set yet.
let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

function defaultFrom(): string {
  return (
    process.env.RESEND_FROM_EMAIL ?? `${BUSINESS.name} <onboarding@resend.dev>`
  );
}

/**
 * Reply-To applied to every send, from RESEND_REPLY_TO.
 *
 * The From is a systematic address (reports@…) so the automated mail reads
 * as system mail rather than personal mail; this points replies at a real
 * inbox so a customer hitting Reply still reaches a human — and so a reply
 * never bounces off an address with no mailbox behind it.
 *
 * Read at call time (like defaultFrom) rather than at module load, so the
 * env can change between sends without a restart. Unset, empty, or
 * whitespace all mean NO Reply-To header — the pre-existing behaviour.
 */
function defaultReplyTo(): string | undefined {
  const value = process.env.RESEND_REPLY_TO?.trim();
  return value ? value : undefined;
}

/**
 * Blind-copy address for customer-facing mail, from RESEND_BCC.
 *
 * Report/agreement/document mail is addressed to the CUSTOMER, so the
 * operator never received a copy of what his own system sent. This puts one
 * in his inbox. BCC rather than To or Cc so the customer never sees the
 * extra address on their copy.
 *
 * Read at call time (like defaultFrom / defaultReplyTo) so the env can change
 * between sends without a restart. Unset, empty, or whitespace all mean NO
 * BCC — the pre-existing behaviour. Only applied when the caller passes
 * `bcc: true`, which the customer-facing senders do and the internal ones
 * (feedback, edit request) deliberately don't.
 */
function defaultBcc(): string | undefined {
  const value = process.env.RESEND_BCC?.trim();
  return value ? value : undefined;
}

/**
 * Send an email. Idempotent at the call-site sense — Resend handles
 * retries; we don't.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (
    recipients.length === 0 ||
    recipients.some((a) => !a.includes("@"))
  ) {
    return { success: false, error: "Invalid recipient address" };
  }
  if (!input.html && !input.text) {
    return { success: false, error: "Email body is empty" };
  }

  const resend = getResend();
  const from = input.from ?? defaultFrom();
  const replyTo = input.replyTo ?? defaultReplyTo();
  const bcc = input.bcc ? defaultBcc() : undefined;

  // Dev fallback — log a digest so workflows are testable without Resend.
  if (!resend) {
    if (process.env.NODE_ENV !== "production") {
      const attachDigest = (input.attachments ?? [])
        .map((a) => `${a.filename}(${Buffer.byteLength(a.content as string | Buffer)}B)`)
        .join(", ");
      // First anchor in the html (label + href), or the first URL in a
      // plain-text body — so link-bearing emails can be eyeballed from
      // the server log alone.
      const anchor = input.html?.match(
        /<a\s+href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/
      );
      const textUrl = !anchor ? input.text?.match(/https?:\/\/\S+/) : null;
      console.log(
        `[email:stub] from=${from}` +
          (replyTo
            ? ` reply_to=${Array.isArray(replyTo) ? replyTo.join(", ") : replyTo}`
            : "") +
          ` to=${recipients.join(", ")}` +
          (bcc ? ` bcc=${bcc}` : "") +
          ` subject=${input.subject}` +
          (attachDigest ? ` attachments=${attachDigest}` : "") +
          (anchor ? ` link="${anchor[2]}" -> ${anchor[1]}` : "") +
          (textUrl ? ` link=${textUrl[0]}` : "")
      );
      return { success: true, id: "stub" };
    }
    return {
      success: false,
      error: "RESEND_API_KEY is not configured",
    };
  }

  try {
    // Resend's TS types require either `html` or `text` — at least one is
    // guaranteed by the guard above.
    const payload = {
      from,
      to: recipients,
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
      // The SDK takes camelCase `replyTo` and puts `reply_to` on the wire.
      // Omitted entirely when unset, so no empty header is sent.
      ...(replyTo ? { replyTo } : {}),
      // Blind copy for the operator on customer-facing mail. Omitted entirely
      // when RESEND_BCC is unset or the sender didn't opt in.
      ...(bcc ? { bcc } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
    } as Parameters<typeof resend.emails.send>[0];

    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.error("[email] Resend error:", error.message);
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] send failed:", msg);
    return { success: false, error: msg };
  }
}

// ── HTML helpers ───────────────────────────────────────────

/**
 * Minimal HTML escape for values we splice into email templates. Belt-and
 * braces — names and PDF URLs go through here before they're embedded.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Service Report Email ───────────────────────────────────

export async function sendServiceReport(
  customer: Customer,
  pdfUrl: string,
  recipients?: string[],
  /** Job date (ISO) — names the attachment "Service Report - 23 July
   *  2026.pdf". Omitted → "Service Report.pdf". */
  jobDate?: string
): Promise<SendEmailResult> {
  // Recipients default to the customer's own email (backward compatible
  // with the deferred completion path); the "Send report now" flow passes
  // an explicit, validated multi-recipient list.
  const to =
    recipients && recipients.length > 0
      ? recipients
      : customer.email
        ? [customer.email]
        : [];
  if (to.length === 0) {
    return { success: false, error: "Customer has no email" };
  }
  const link = await signedEmailLink(pdfUrl);
  const pdf = await downloadReportPdf(pdfUrl);
  const filename = jobDate
    ? `Service Report - ${ukDateForFilename(jobDate)}.pdf`
    : "Service Report.pdf";
  return sendEmail({
    to,
    subject: `${BUSINESS.name} – Your Service Report`,
    html: serviceReportHtml(customer.name, link),
    bcc: true,
    ...(pdf ? { attachments: [{ filename, content: pdf }] } : {}),
  });
}

// ── Agreement Email ────────────────────────────────────────

export async function sendAgreement(
  customer: Customer,
  pdfUrl: string,
  recipients?: string[],
  /** Agreement reference — names the attachment "Agreement -
   *  <reference>.pdf". Omitted → "Agreement.pdf". */
  reference?: string
): Promise<SendEmailResult> {
  const to =
    recipients && recipients.length > 0
      ? recipients
      : customer.email
        ? [customer.email]
        : [];
  if (to.length === 0) {
    return { success: false, error: "Customer has no email" };
  }
  const link = await signedEmailLink(pdfUrl);
  const pdf = await downloadReportPdf(pdfUrl);
  const filename = reference
    ? `Agreement - ${reference}.pdf`
    : "Agreement.pdf";
  return sendEmail({
    to,
    subject: `${BUSINESS.name} – Your Pest Management Agreement`,
    html: agreementHtml(customer.name, link),
    bcc: true,
    ...(pdf ? { attachments: [{ filename, content: pdf }] } : {}),
  });
}

/**
 * Send the UNSIGNED review copy of an agreement (draft flow): the customer
 * reads it before signing. Same multi-recipient + signed-link plumbing as
 * sendAgreement, but a distinct subject and a review-specific body.
 */
export async function sendAgreementReview(
  customer: Customer,
  pdfUrl: string,
  recipients?: string[],
  /** Agreement reference — names the attachment "Agreement for review -
   *  <reference>.pdf". Omitted → "Agreement for review.pdf". */
  reference?: string
): Promise<SendEmailResult> {
  const to =
    recipients && recipients.length > 0
      ? recipients
      : customer.email
        ? [customer.email]
        : [];
  if (to.length === 0) {
    return { success: false, error: "Customer has no email" };
  }
  const link = await signedEmailLink(pdfUrl);
  const pdf = await downloadReportPdf(pdfUrl);
  const filename = reference
    ? `Agreement for review - ${reference}.pdf`
    : "Agreement for review.pdf";
  return sendEmail({
    to,
    subject: `${BUSINESS.name} – Your pest management agreement to review`,
    html: agreementReviewHtml(customer.name, link),
    bcc: true,
    ...(pdf ? { attachments: [{ filename, content: pdf }] } : {}),
  });
}

// ── Library Document Email ─────────────────────────────────

/**
 * Email a static site-folder library document as an attachment. Reuses the
 * generic primitives — `downloadReportPdf` (which downloads ANY object in the
 * reports bucket, not just report PDFs) and `sendEmail`'s multi-recipient +
 * attachment support — rather than the report-specific senders above.
 *
 * Attachment-only by design: a library email exists to deliver the file, so
 * if the download fails there is no useful link-only fallback and we return
 * an error (unlike the report senders, which degrade to link-only). The
 * `filename` extension drives the MIME type Resend infers, so pass the
 * document's real name (e.g. "Method Statement.docx").
 */
export async function sendLibraryDocument(
  recipients: string[],
  storagePath: string,
  fileName: string,
  label: string
): Promise<SendEmailResult> {
  if (recipients.length === 0) {
    return { success: false, error: "Add at least one recipient" };
  }
  const file = await downloadReportPdf(storagePath);
  if (!file) {
    return { success: false, error: "Could not load the document to attach" };
  }
  return sendDocumentAttachment(recipients, file, fileName, label);
}

/**
 * Email an ALREADY-LOADED document as an attachment — the generic sender
 * behind both the library email above and the Documents-list "Email" action.
 *
 * Takes bytes rather than a storage path because not every document has a
 * stored object to fetch: a quote's PDF is rendered lazily, so the caller may
 * have just generated the buffer in memory. Deliberately NOT the
 * report-specific `sendServiceReport` — the subject and body name whatever
 * document was sent, so it reads correctly for a quote, an invoice, an
 * agreement or a service sheet.
 *
 * `fileName`'s extension drives the MIME type Resend infers, so pass the real
 * name. Customer-facing, so it carries the RESEND_BCC copy.
 */
export async function sendDocumentAttachment(
  recipients: string[],
  content: Buffer,
  fileName: string,
  label: string
): Promise<SendEmailResult> {
  if (recipients.length === 0) {
    return { success: false, error: "Add at least one recipient" };
  }
  return sendEmail({
    to: recipients,
    subject: `${BUSINESS.name} – ${label}`,
    html: libraryDocumentHtml(label),
    attachments: [{ filename: fileName, content }],
    bcc: true,
  });
}

function libraryDocumentHtml(label: string): string {
  const safeLabel = escapeHtml(label);
  return emailWrapper(`
    <p style="font-size:15px;color:#1f2937;margin:0 0 16px;">Hello,</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
      Please find the following document attached to this email:
    </p>
    <p style="font-size:15px;color:#1f2937;font-weight:600;margin:0 0 24px;">
      ${safeLabel}
    </p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 0;">
      If you have any questions, please get in touch.
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      Kind regards,<br />
      <strong style="color:#1f2937;">${escapeHtml(BUSINESS.name)}</strong>
    </p>
  `);
}

// ── HTML Templates ─────────────────────────────────────────

function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:#75B845;padding:24px 32px;">
              <span style="color:#fff;font-size:20px;font-weight:700;">${escapeHtml(BUSINESS.name)}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.6;">
              ${escapeHtml(BUSINESS.name)} &mdash; Professional Pest Management<br />
              This email was sent from ${escapeHtml(BUSINESS.name)} CRM.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function serviceReportHtml(name: string, pdfUrl: string): string {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(pdfUrl);
  return emailWrapper(`
    <p style="font-size:15px;color:#1f2937;margin:0 0 16px;">Dear ${safeName},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
      Thank you for choosing ${escapeHtml(BUSINESS.name)}. Please find your service report attached to this email.
    </p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">
      The report includes details of the visit, findings, any treatments carried out, and our recommendations.
    </p>
    <a href="${safeUrl}" style="display:inline-block;background:#75B845;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
      View online copy
    </a>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:24px 0 0;">
      If you have any questions, please don't hesitate to get in touch.
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      Kind regards,<br />
      <strong style="color:#1f2937;">${escapeHtml(BUSINESS.name)}</strong>
    </p>
  `);
}

function agreementReviewHtml(name: string, pdfUrl: string): string {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(pdfUrl);
  return emailWrapper(`
    <p style="font-size:15px;color:#1f2937;margin:0 0 16px;">Dear ${safeName},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
      Please take a moment to read through your pest management agreement below before we sign it together. This is a copy for your review only. It has not yet been signed.
    </p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">
      It sets out the services we will provide, the visit frequency, and our terms. We will go through it and sign together on our visit.
    </p>
    <a href="${safeUrl}" style="display:inline-block;background:#75B845;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
      View online copy
    </a>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:24px 0 0;">
      If you have any questions before then, please get in touch.
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      Kind regards,<br />
      <strong style="color:#1f2937;">${escapeHtml(BUSINESS.name)}</strong>
    </p>
  `);
}

function agreementHtml(name: string, pdfUrl: string): string {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(pdfUrl);
  return emailWrapper(`
    <p style="font-size:15px;color:#1f2937;margin:0 0 16px;">Dear ${safeName},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
      Thank you for entering into a pest management agreement with ${escapeHtml(BUSINESS.name)}. Please find your signed agreement attached.
    </p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px;">
      This agreement outlines the services we will provide, visit frequency, and terms of our arrangement.
    </p>
    <a href="${safeUrl}" style="display:inline-block;background:#75B845;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
      View online copy
    </a>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:24px 0 0;">
      We look forward to working with you. If you have any questions, please get in touch.
    </p>
    <p style="font-size:14px;color:#6b7280;margin:16px 0 0;">
      Kind regards,<br />
      <strong style="color:#1f2937;">${escapeHtml(BUSINESS.name)}</strong>
    </p>
  `);
}
