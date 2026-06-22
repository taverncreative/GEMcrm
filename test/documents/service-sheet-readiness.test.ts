import { describe, it, expect } from "vitest";
import { customerServiceSheetReadiness } from "@/lib/documents/service-sheet-readiness";

const fullCustomer = {
  name: "Shelly",
  phone: "01234 555123",
  email: "shelly@example.com",
};
const fullSite = { address_line_1: "42 Riverside Estate", town: "Riverside" };

describe("customerServiceSheetReadiness", () => {
  it("is ready when name, phone, email and a usable site address are all present", () => {
    const r = customerServiceSheetReadiness(fullCustomer, fullSite);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  // ─── Each required field independently flips ready + is reported ──────

  it("blocks and reports `name` (routed to the customer) when name is blank", () => {
    const r = customerServiceSheetReadiness({ ...fullCustomer, name: "" }, fullSite);
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual(["name"]);
    expect(r.missing[0].fixOn).toBe("customer");
  });

  it("blocks and reports `phone` (routed to the customer) when phone is blank", () => {
    const r = customerServiceSheetReadiness({ ...fullCustomer, phone: "" }, fullSite);
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual(["phone"]);
    expect(r.missing[0].fixOn).toBe("customer");
  });

  it("blocks and reports `email` (routed to the customer) when email is blank", () => {
    const r = customerServiceSheetReadiness({ ...fullCustomer, email: "" }, fullSite);
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual(["email"]);
    expect(r.missing[0].fixOn).toBe("customer");
  });

  it("blocks and reports `site_address` (routed to the site) when line 1 is blank", () => {
    const r = customerServiceSheetReadiness(fullCustomer, {
      ...fullSite,
      address_line_1: "",
    });
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual(["site_address"]);
    expect(r.missing[0].fixOn).toBe("site");
  });

  it("blocks on `site_address` when town is blank (a usable address needs BOTH line 1 and town)", () => {
    const r = customerServiceSheetReadiness(fullCustomer, {
      ...fullSite,
      town: "",
    });
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual(["site_address"]);
  });

  // ─── Boundary cases ──────────────────────────────────────────────────

  it("treats whitespace-only values as blank", () => {
    const r = customerServiceSheetReadiness(
      { ...fullCustomer, phone: "   " },
      fullSite
    );
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual(["phone"]);
  });

  it("does NOT require a postcode (line 1 + town alone is a usable address)", () => {
    const r = customerServiceSheetReadiness(fullCustomer, {
      address_line_1: "42 Riverside Estate",
      town: "Riverside",
    });
    expect(r.ready).toBe(true);
  });

  it("a thin relaxed-booking customer + bare site reports every missing field, in order", () => {
    const r = customerServiceSheetReadiness(
      { name: "", phone: null, email: null },
      { address_line_1: null, town: null }
    );
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual([
      "name",
      "phone",
      "email",
      "site_address",
    ]);
  });

  it("treats a null customer / null site as fully missing (defensive)", () => {
    const r = customerServiceSheetReadiness(null, null);
    expect(r.ready).toBe(false);
    expect(r.missing.map((f) => f.key)).toEqual([
      "name",
      "phone",
      "email",
      "site_address",
    ]);
  });
});
