/**
 * Environmental Risk Assessment (ERA) — the optional service-sheet box Nate
 * fills when toxic bait is used outdoors.
 *
 * Shape, mirroring the call_type "Other" pattern:
 *   - the text lives in jobs.environmental_comments (migration 007's unused
 *     column, adopted rather than duplicated). There is NO era_required
 *     column: presence of the text is the flag;
 *   - optional throughout — absent from isServiceSheetFilled and from the DB
 *     completion CHECK, so it can never block a completion;
 *   - EXCEPT that ticking the box and leaving it empty blocks at the review
 *     gate, because a tick that says nothing is worse than no tick;
 *   - the storage rule clears the text to null when the tick is off, so
 *     abandoned typing never reaches the row or a customer PDF.
 */
import { describe, it, expect } from "vitest";
import {
  ServiceSheetSchema,
  isServiceSheetFilled,
} from "@/lib/validation/service-sheet";
import { environmentalCommentsForStorage } from "@/lib/utils/environmental-comments";

const baseSheet = {
  job_id: "j1",
  call_type: "routine" as const,
  call_type_other_desc: "",
  pest_species: ["Rats"],
  findings: "f",
  recommendations: "r",
  method_used: ["Inspection"],
  risk_level: "low" as const,
  risk_comments: "none",
  technician_signature: "data:image/png;base64,x",
};

describe("required-when-ticked on the service-sheet schema", () => {
  it("rejects a ticked ERA with an empty box", () => {
    const res = ServiceSheetSchema.safeParse({
      ...baseSheet,
      era_required: true,
      environmental_comments: "",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) =>
        i.path.includes("environmental_comments")
      );
      expect(issue).toBeDefined();
      // The escape hatch has to be in the copy: the ERA is optional, so a
      // mis-tick on a job that needs none must never be a dead end.
      expect(issue?.message).toBe(
        "Describe the environmental risk, or untick the box"
      );
    }
  });

  it("rejects a ticked ERA holding only whitespace", () => {
    const res = ServiceSheetSchema.safeParse({
      ...baseSheet,
      era_required: true,
      environmental_comments: "   ",
    });
    expect(res.success).toBe(false);
  });

  it("accepts a ticked ERA with text", () => {
    const res = ServiceSheetSchema.safeParse({
      ...baseSheet,
      era_required: true,
      environmental_comments: "Bait in tamper-resistant stations.",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.environmental_comments).toBe(
        "Bait in tamper-resistant stations."
      );
    }
  });

  it("accepts a sheet with no ERA at all — the common case", () => {
    const res = ServiceSheetSchema.safeParse(baseSheet);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.era_required).toBe(false);
      expect(res.data.environmental_comments).toBe("");
    }
  });

  it("accepts an unticked ERA even with stale text in the field", () => {
    const res = ServiceSheetSchema.safeParse({
      ...baseSheet,
      era_required: false,
      environmental_comments: "typed then unticked",
    });
    expect(res.success).toBe(true);
  });
});

describe("storage rule: environmentalCommentsForStorage", () => {
  it("keeps the text when the tick is on", () => {
    expect(environmentalCommentsForStorage(true, "Non-targets considered")).toBe(
      "Non-targets considered"
    );
  });

  it("trims", () => {
    expect(environmentalCommentsForStorage(true, "  spaced  ")).toBe("spaced");
  });

  it("stores NULL when the tick is off, even with stale text", () => {
    expect(
      environmentalCommentsForStorage(false, "typed then unticked")
    ).toBeNull();
  });

  it("stores NULL for a ticked but blank box", () => {
    expect(environmentalCommentsForStorage(true, "   ")).toBeNull();
    expect(environmentalCommentsForStorage(true, "")).toBeNull();
  });

  it("handles null/undefined input", () => {
    expect(environmentalCommentsForStorage(true, null)).toBeNull();
    expect(environmentalCommentsForStorage(undefined, "x")).toBeNull();
  });
});

describe("the ERA never gates completion", () => {
  const filledJob = {
    findings: "f",
    recommendations: "r",
    risk_level: "low",
    risk_comments: "none",
    pest_species: ["Rats"],
    method_used: ["Inspection"],
  };

  it("isServiceSheetFilled passes without any ERA", () => {
    expect(isServiceSheetFilled(filledJob)).toBe(true);
  });

  it("isServiceSheetFilled is unchanged by the presence of one", () => {
    expect(
      isServiceSheetFilled({
        ...filledJob,
        // Extra key is ignored by the predicate — pinning that the ERA is not
        // part of the completion contract (nor of the DB CHECK it mirrors).
        ...({ environmental_comments: "ERA text" } as Record<string, unknown>),
      })
    ).toBe(true);
  });
});
