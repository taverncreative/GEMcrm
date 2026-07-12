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
 *   RESEND_FROM_EMAIL   — verified sender, e.g. "GEM Services <nate@gemservices.uk>"
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

async function signedEmailLink(storedUrl: string): Promise<string> {
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

interface SendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Override the default sender for one-off cases (e.g. forwarding). */
  from?: string;
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
 * Send an email. Idempotent at the call-site sense — Resend handles
 * retries; we don't.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!input.to || !input.to.includes("@")) {
    return { success: false, error: "Invalid recipient address" };
  }
  if (!input.html && !input.text) {
    return { success: false, error: "Email body is empty" };
  }

  const resend = getResend();
  const from = input.from ?? defaultFrom();

  // Dev fallback — log a digest so workflows are testable without Resend.
  if (!resend) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[email:stub] from=${from} to=${input.to} subject=${input.subject}`
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
      to: input.to,
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
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
  pdfUrl: string
): Promise<SendEmailResult> {
  if (!customer.email) {
    return { success: false, error: "Customer has no email" };
  }
  const link = await signedEmailLink(pdfUrl);
  return sendEmail({
    to: customer.email,
    subject: `${BUSINESS.name} – Your Service Report`,
    html: serviceReportHtml(customer.name, link),
  });
}

// ── Agreement Email ────────────────────────────────────────

export async function sendAgreement(
  customer: Customer,
  pdfUrl: string
): Promise<SendEmailResult> {
  if (!customer.email) {
    return { success: false, error: "Customer has no email" };
  }
  const link = await signedEmailLink(pdfUrl);
  return sendEmail({
    to: customer.email,
    subject: `${BUSINESS.name} – Your Pest Management Agreement`,
    html: agreementHtml(customer.name, link),
  });
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
      View Report
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
      View Agreement
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
