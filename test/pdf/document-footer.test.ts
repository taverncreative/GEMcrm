/**
 * The shared document footer (lib/pdf/templates/partials.ts → renderDocumentFooter).
 * It is the single source htmlToPdf stamps on every page of every PDF, so a
 * regression here changes the footer on ALL documents at once. Pins:
 *   - the partial renders the branded band markup (the baked PNG band);
 *   - the footer CONTENT (phone / email / web + legal trading-name line) is the
 *     exact FOOTER_CONTACT branding constant, so it can't silently drift.
 */
import { describe, it, expect } from "vitest";
import { renderDocumentFooter } from "@/lib/pdf/templates/partials";
import { FOOTER_CONTACT } from "@/lib/constants/branding";

describe("renderDocumentFooter", () => {
  it("renders the full-width branded band image markup", () => {
    const html = renderDocumentFooter();
    expect(html).toContain("<img");
    expect(html).toContain("data:image/png;base64,");
    // Full-bleed width + the bottom-edge shift the running footer relies on.
    expect(html).toContain("width:100%");
    expect(html).toContain("translateY(24px)");
  });
});

describe("footer content matches the branding constants", () => {
  it("carries the exact contact + legal strings from FOOTER_CONTACT", () => {
    // The band image is baked from these; this pins the source of truth the
    // regen script (scripts/generate-footer-band.ts) reads.
    expect(FOOTER_CONTACT.phone).toBe("07400 372 204");
    expect(FOOTER_CONTACT.email).toBe("NATE@GEMSERVICES.UK");
    expect(FOOTER_CONTACT.website).toBe("WWW.GEMSERVICES.UK");
    expect(FOOTER_CONTACT.legal).toBe(
      "GEM Services is a trading name of GREEN ENVIRONMENTAL MANAGEMENT LTD. Company number 16671563"
    );
  });
});
