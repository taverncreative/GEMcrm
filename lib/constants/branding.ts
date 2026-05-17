/**
 * Single place for client-facing brand strings.
 *
 * Hardcoding "GEM Services" was previously scattered across 12+ files; if
 * the operator name changes (or the CRM is ever reused for another client)
 * we want one place to update. Email subjects, footers, and the dashboard
 * welcome all source from here.
 */

export const BUSINESS = {
  /** Display name used in emails, headers, signatures. */
  name: "GEM Services",
  /** Person who signs off invoice / reminder emails. */
  signoffName: "Nate Green",
  /** Catch-all contact email for developer/support requests (used by the
   *  Settings → Feature request form). Not customer-facing. */
  supportEmail: "hello@businesssortedkent.co.uk",
  /** Public Google review URL. Override via REVIEW_LINK_URL env if needed. */
  reviewUrl: process.env.REVIEW_LINK_URL ?? "https://g.page/r/CYNNFaOXPoYuEBM/review",
} as const;
