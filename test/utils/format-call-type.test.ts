/**
 * formatCallType — the DETAIL-surface label that folds the "Other"
 * description in as "Other: <desc>" (the scalar analogue of how the
 * pest/method "Other: <desc>" strings print inline). Compact chips call
 * CALL_TYPE_LABELS directly and stay plain "Other", so they are not tested
 * here.
 */
import { describe, it, expect } from "vitest";
import { formatCallType, CALL_TYPE_LABELS } from "@/lib/constants/job-labels";

describe("formatCallType", () => {
  it("folds the description in as 'Other: <desc>' when other + desc", () => {
    expect(formatCallType("other", "Insect identification")).toBe(
      "Other: Insect identification"
    );
  });

  it("trims the description", () => {
    expect(formatCallType("other", "  Insect ID  ")).toBe("Other: Insect ID");
  });

  it("is plain 'Other' when the description is missing or blank", () => {
    expect(formatCallType("other", "")).toBe("Other");
    expect(formatCallType("other", null)).toBe("Other");
    expect(formatCallType("other", undefined)).toBe("Other");
  });

  it("uses the plain label for non-other types and ignores any stray desc", () => {
    expect(formatCallType("routine")).toBe(CALL_TYPE_LABELS.routine);
    expect(formatCallType("callout", "ignored")).toBe(CALL_TYPE_LABELS.callout);
  });

  it("returns empty string for a null/absent call type", () => {
    expect(formatCallType(null)).toBe("");
    expect(formatCallType(undefined)).toBe("");
  });

  it("falls back to the raw value for an unknown type", () => {
    expect(formatCallType("mystery")).toBe("mystery");
  });
});
