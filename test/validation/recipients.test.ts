import { describe, it, expect } from "vitest";
import {
  splitRecipients,
  validateRecipients,
  parseAndValidateRecipients,
} from "@/lib/validation/recipients";

describe("splitRecipients", () => {
  it("splits on comma, newline, semicolon; trims; drops empties", () => {
    expect(splitRecipients("a@x.com, b@x.com;c@x.com\nd@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
    expect(splitRecipients("  a@x.com ,, ")).toEqual(["a@x.com"]);
    expect(splitRecipients("")).toEqual([]);
  });
});

describe("validateRecipients", () => {
  it("a valid list passes and is returned in order", () => {
    const r = validateRecipients(["a@x.com", "b@x.com"]);
    expect(r).toEqual({ ok: true, emails: ["a@x.com", "b@x.com"] });
  });

  it("dedupes case-insensitively, keeping first occurrence", () => {
    const r = validateRecipients(["A@x.com", "a@x.com", "b@x.com"]);
    expect(r.ok && r.emails).toEqual(["A@x.com", "b@x.com"]);
  });

  it("one invalid address hard-blocks and names it", () => {
    const r = validateRecipients(["a@x.com", "not-an-email"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not-an-email");
  });

  it("empty list is rejected", () => {
    const r = validateRecipients([]);
    expect(r.ok).toBe(false);
  });
});

describe("parseAndValidateRecipients", () => {
  it("parses a comma string and validates end to end", () => {
    const r = parseAndValidateRecipients("a@x.com, b@x.com");
    expect(r).toEqual({ ok: true, emails: ["a@x.com", "b@x.com"] });
  });

  it("blocks when the string contains an invalid address", () => {
    const r = parseAndValidateRecipients("a@x.com, nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("nope");
  });
});
