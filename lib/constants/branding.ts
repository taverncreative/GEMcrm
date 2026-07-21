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
  /**
   * Whether GEM is VAT-registered. Currently FALSE — turnover is under the
   * threshold, so invoices charge NO VAT (the gross amount is the total, no
   * breakdown, no VAT number shown). This is the single switch: flip to
   * true when GEM registers and every path starts applying the 20%
   * standard-rated split + showing the VAT number — no rebuild, just config.
   */
  vatRegistered: false,
  /**
   * HMRC VAT registration number, shown on invoices ONLY when
   * vatRegistered is true. Pest control is standard-rated 20%, so a
   * compliant VAT invoice MUST display this. EMPTY until supplied — once
   * registered, the template renders a "[ADD VAT No.]" placeholder so it
   * can't be issued blank. Set this when GEM registers.
   */
  vatNumber: "",
  /** Person who signs off invoice / reminder emails. */
  signoffName: "Nate Green",
  /** Catch-all contact email for developer/support requests (used by the
   *  Settings → Feature request form). Not customer-facing. */
  supportEmail: "hello@businesssortedkent.co.uk",
  /** Public Google review URL. Override via REVIEW_LINK_URL env if needed. */
  reviewUrl: process.env.REVIEW_LINK_URL ?? "https://g.page/r/CYNNFaOXPoYuEBM/review",
} as const;

/**
 * Contact + legal line shown in the green PDF document footer.
 *
 * THIS is the single source of truth. renderDocumentFooter() (lib/pdf/templates/
 * partials.ts) renders these values directly as the per-page footer band (text +
 * CSS, #9AC44B), so editing here updates every document with no build step. A
 * bullet separates the contact items on line 1.
 */
export const FOOTER_CONTACT = {
  phone: "07400 372 204",
  email: "NATE@GEMSERVICES.UK",
  website: "WWW.GEMSERVICES.UK",
  legal:
    "GEM Services is a trading name of GREEN ENVIRONMENTAL MANAGEMENT LTD. Company number 16671563",
} as const;
