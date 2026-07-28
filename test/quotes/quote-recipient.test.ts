/**
 * Which address a quote's email prefills with.
 *
 * The quote's OWN bill-to address wins over the linked customer record: a
 * prospect quote has no customer to fall back to (customer_id null), and a
 * quote for an existing customer may be deliberately addressed elsewhere.
 * Shared by the Documents list and the quote detail page so the two entry
 * points can't disagree.
 */
import { describe, it, expect } from "vitest";
import { quoteRecipientEmail } from "@/lib/quotes/recipient";

describe("quoteRecipientEmail", () => {
  it("uses the quote's own address when set", () => {
    expect(quoteRecipientEmail("quote@example.test", "customer@example.test")).toBe(
      "quote@example.test"
    );
  });

  it("falls back to the linked customer when the quote has none", () => {
    expect(quoteRecipientEmail(null, "customer@example.test")).toBe(
      "customer@example.test"
    );
    expect(quoteRecipientEmail("", "customer@example.test")).toBe(
      "customer@example.test"
    );
    expect(quoteRecipientEmail("   ", "customer@example.test")).toBe(
      "customer@example.test"
    );
  });

  it("handles a PROSPECT quote: own address, no customer at all", () => {
    expect(quoteRecipientEmail("prospect@example.test", null)).toBe(
      "prospect@example.test"
    );
    expect(quoteRecipientEmail("prospect@example.test", undefined)).toBe(
      "prospect@example.test"
    );
  });

  it("returns empty when there is nothing to prefill", () => {
    expect(quoteRecipientEmail(null, null)).toBe("");
    expect(quoteRecipientEmail(undefined, undefined)).toBe("");
    expect(quoteRecipientEmail("  ", "  ")).toBe("");
  });

  it("trims", () => {
    expect(quoteRecipientEmail("  quote@example.test  ", null)).toBe(
      "quote@example.test"
    );
    expect(quoteRecipientEmail(null, "  customer@example.test ")).toBe(
      "customer@example.test"
    );
  });
});
