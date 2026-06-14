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

/**
 * Contact + legal line shown in the green PDF document footer.
 *
 * The footer is rendered as a pre-baked IMAGE (scripts/generate-footer-band.ts)
 * so the band pins to the bottom of every page via Puppeteer's footerTemplate
 * with exact Montserrat + #9AC44B. THIS is the single source of truth — after
 * editing here, regenerate the asset:  npx tsx scripts/generate-footer-band.ts
 * (the diamond ◆ separates the contact items on line 1).
 */
export const FOOTER_CONTACT = {
  phone: "07400 372 204",
  email: "NATE@GEMSERVICES.UK",
  website: "WWW.GEMSERVICES.UK",
  legal:
    "GEM Services is a trading name of GREEN ENVIRONMENTAL MANAGEMENT LTD. Company number 16671563",
} as const;
