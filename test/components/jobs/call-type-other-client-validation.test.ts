/**
 * Regression: the service sheet's CLIENT-side validator builds its own raw
 * object out of FormData and runs ServiceSheetSchema against it (the server
 * is never called at submit on the optimistic path, so this IS the gate).
 *
 * call_type_other_desc was initially missing from that builder, so the
 * schema's required-when-Other superRefine saw a blank description and
 * bounced the review modal even though the operator HAD typed one and the
 * hidden input carried it. Caught in :3002 verification. These pin both
 * directions so the builder can't drop the field again.
 */
import { describe, it, expect } from "vitest";
import { validateServiceSheetFormData } from "@/components/jobs/service-sheet-form";

function sheetFormData(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    job_id: "j1",
    call_type: "other",
    call_type_other_desc: "Bird proofing survey",
    pest_species: JSON.stringify(["Rats"]),
    findings: "f",
    recommendations: "r",
    report_notes: "",
    method_used: JSON.stringify(["Inspection"]),
    pesticides_used: "None",
    risk_level: "low",
    risk_comments: "none",
    photo_data_urls: JSON.stringify([]),
    technician_signature: "data:image/png;base64,x",
    client_present: "",
    client_signature: "",
    client_name: "",
    invoice_required: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

describe("client-side sheet validation carries call_type_other_desc", () => {
  it("an 'other' call type WITH a description passes (the regression)", () => {
    expect(validateServiceSheetFormData(sheetFormData())).toBeNull();
  });

  it("an 'other' call type with a blank description is rejected", () => {
    const errs = validateServiceSheetFormData(
      sheetFormData({ call_type_other_desc: "" })
    );
    expect(errs?.call_type_other_desc).toBe("Describe the other call type");
  });

  it("a non-other call type needs no description", () => {
    expect(
      validateServiceSheetFormData(
        sheetFormData({ call_type: "routine", call_type_other_desc: "" })
      )
    ).toBeNull();
  });
});
