/**
 * Unit tests for ServiceSheetSchema — pinpoints the null-vs-undefined
 * Zod failure that left three jobs stuck in the conflict inbox.
 *
 * Background: completeServiceSheetAction parsed FormData with
 * `formData.get(key) as string`. When a field is missing (e.g.
 * client_name when Customer Present = No), formData.get() returns
 * null, not undefined. Zod's `.optional().default("")` accepts
 * undefined but REJECTS null — so the schema fails with
 * "Expected string, received null" on client_name and the whole
 * action returns failure.
 *
 * The fix coerces null → "" in the action before passing to Zod.
 * These tests prove the schema's behaviour at both ends of the
 * fix so a future regression in the action's parsing surfaces here
 * instead of in the conflict inbox.
 */
import { describe, it, expect } from "vitest";
import { ServiceSheetSchema } from "@/lib/validation/service-sheet";

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "test-job-id",
    call_type: "routine",
    pest_species: ["Mice"],
    findings: "Mice droppings in kitchen",
    recommendations: "Place bait stations",
    report_notes: "",
    method_used: ["Rodenticide Used"],
    pesticides_used: "Bromadiolone 0.005%",
    risk_level: "low",
    risk_comments: "Standard rodent treatment",
    photo_data_urls: [],
    technician_signature: "data:image/png;base64,STUB",
    client_present: "",
    client_signature: "",
    client_name: "",
    ...overrides,
  };
}

describe("ServiceSheetSchema — Customer Present = No path", () => {
  it("accepts an empty string client_name (post-fix shape)", () => {
    const result = ServiceSheetSchema.safeParse(
      validRaw({ client_name: "", client_signature: "", client_present: "" })
    );
    expect(result.success).toBe(true);
  });

  it("REJECTS null client_name — this is the bug the action was emitting", () => {
    // FormData.get() returns null for missing keys. Without the
    // action's null→"" coalesce, this is exactly what the schema saw,
    // which is what triggered the stuck-in-inbox failures.
    const result = ServiceSheetSchema.safeParse(
      validRaw({ client_name: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues;
      expect(
        issues.some(
          (i) => i.path[0] === "client_name" && /string/i.test(i.message)
        )
      ).toBe(true);
    }
  });

  it("REJECTS null client_signature for the same reason", () => {
    // Even though there IS an always-present hidden client_signature
    // input today, this test proves the schema is symmetric — any
    // optional string field is brittle to null and the action's
    // coalesce protects every one of them.
    const result = ServiceSheetSchema.safeParse(
      validRaw({ client_signature: null })
    );
    expect(result.success).toBe(false);
  });

  it("accepts the full Customer Present = Yes shape", () => {
    const result = ServiceSheetSchema.safeParse(
      validRaw({
        client_present: "true",
        client_signature: "data:image/png;base64,CLIENT",
        client_name: "Jane Doe",
      })
    );
    expect(result.success).toBe(true);
  });
});
