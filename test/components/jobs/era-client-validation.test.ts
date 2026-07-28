/**
 * ERA through the CLIENT-side validator — the same trap call_type_other_desc
 * fell into. The server is never called at submit on the optimistic path, so
 * validateServiceSheetFormData (which rebuilds a raw object from FormData) IS
 * the gate. If the builder drops era_required or environmental_comments, the
 * superRefine silently sees a blank ERA and either bounces a filled sheet or
 * waves through a ticked-but-empty one.
 *
 * The hidden inputs blank environmental_comments when the tick is off, so the
 * untick case here carries era_required="" with an empty box, exactly the
 * shape the form emits.
 */
import { describe, it, expect } from "vitest";
import { validateServiceSheetFormData } from "@/components/jobs/service-sheet-form";

function sheetFormData(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    job_id: "j1",
    call_type: "routine",
    call_type_other_desc: "",
    pest_species: JSON.stringify(["Rats"]),
    findings: "f",
    recommendations: "r",
    report_notes: "",
    method_used: JSON.stringify(["Inspection"]),
    risk_level: "low",
    risk_comments: "none",
    era_required: "",
    environmental_comments: "",
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

describe("client-side sheet validation carries the ERA fields", () => {
  it("no ERA at all passes — the common case", () => {
    expect(validateServiceSheetFormData(sheetFormData())).toBeNull();
  });

  it("ticked WITH text passes", () => {
    expect(
      validateServiceSheetFormData(
        sheetFormData({
          era_required: "true",
          environmental_comments: "Bait in tamper-resistant stations.",
        })
      )
    ).toBeNull();
  });

  it("ticked with an EMPTY box is rejected, with the escape hatch in the copy", () => {
    const errs = validateServiceSheetFormData(
      sheetFormData({ era_required: "true", environmental_comments: "" })
    );
    expect(errs?.environmental_comments).toBe(
      "Describe the environmental risk, or untick the box"
    );
  });

  it("ticked with whitespace only is rejected", () => {
    const errs = validateServiceSheetFormData(
      sheetFormData({ era_required: "true", environmental_comments: "   " })
    );
    expect(errs?.environmental_comments).toBeTruthy();
  });

  it("unticked passes even if stale text somehow rides along", () => {
    expect(
      validateServiceSheetFormData(
        sheetFormData({
          era_required: "",
          environmental_comments: "typed then unticked",
        })
      )
    ).toBeNull();
  });

  it("missing ERA keys entirely (a stale client) still passes", () => {
    const fd = sheetFormData();
    fd.delete("era_required");
    fd.delete("environmental_comments");
    expect(validateServiceSheetFormData(fd)).toBeNull();
  });
});
