/**
 * The shared document footer (lib/pdf/templates/partials.ts → renderDocumentFooter).
 * It is the single source htmlToPdf stamps (as Puppeteer's footerTemplate) on
 * every page of every PDF, so a regression here changes the footer on ALL
 * documents at once. Pins:
 *   - the partial renders the branded band as TEXT + CSS, not an image — headless
 *     Chromium does not paint images in the footer context, which was the prod
 *     "missing footer" bug, so this guards against a regression back to an <img>;
 *   - the footer CONTENT (phone / email / web + legal trading-name line) is the
 *     exact FOOTER_CONTACT branding constant, rendered inline, so it can't drift.
 */
import { describe, it, expect } from "vitest";
import { renderDocumentFooter } from "@/lib/pdf/templates/partials";
import { FOOTER_CONTACT } from "@/lib/constants/branding";

describe("renderDocumentFooter", () => {
  const html = renderDocumentFooter();

  it("renders the branded band as text + CSS (never an image)", () => {
    // The footer context in headless Chromium does not paint images — an <img>
    // here would silently vanish on prod (@sparticuz/chromium). Keep it text.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:image");
    // Brand green + full-width so the band bleeds across the footer region.
    expect(html.toLowerCase()).toContain("#9ac44b");
    expect(html).toContain("width:100%");
  });

  it("carries the exact FOOTER_CONTACT strings inline", () => {
    expect(html).toContain(FOOTER_CONTACT.phone);
    expect(html).toContain(FOOTER_CONTACT.email);
    expect(html).toContain(FOOTER_CONTACT.website);
    expect(html).toContain(FOOTER_CONTACT.legal);
  });

  it("separates the contact items with a bullet, not a diamond", () => {
    // The diamond glyph (&#9670;) is missing from the serverless Linux fallback
    // font and rendered as a blank gap on prod; the bullet (&#8226;) is present.
    expect(html).toContain("&#8226;");
    expect(html).not.toContain("&#9670;");
  });
});

describe("footer content matches the branding constants", () => {
  it("carries the exact contact + legal strings from FOOTER_CONTACT", () => {
    expect(FOOTER_CONTACT.phone).toBe("07400 372 204");
    expect(FOOTER_CONTACT.email).toBe("NATE@GEMSERVICES.UK");
    expect(FOOTER_CONTACT.website).toBe("WWW.GEMSERVICES.UK");
    expect(FOOTER_CONTACT.legal).toBe(
      "GEM Services is a trading name of GREEN ENVIRONMENTAL MANAGEMENT LTD. Company number 16671563"
    );
  });
});
