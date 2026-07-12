import { describe, it, expect } from "vitest";
import {
  resolveSheetAddress,
  formatSheetAddress,
} from "@/lib/documents/resolve-sheet-address";

const siteAddr = {
  address_line_1: "1 Industrial Way",
  address_line_2: null,
  town: "Testford",
  county: "Kent",
  postcode: "TF1 1AA",
};
const customerAddr = {
  address_line_1: "22 Garden Lane",
  address_line_2: null,
  town: "Testford",
  county: "Kent",
  postcode: "TF2 2BB",
};
const bare = {
  address_line_1: null,
  address_line_2: null,
  town: null,
  county: "—",
  postcode: null,
};

describe("resolveSheetAddress", () => {
  it("uses the site address when the site has one", () => {
    const r = resolveSheetAddress(siteAddr, customerAddr);
    expect(r.source).toBe("site");
    expect(r.address_line_1).toBe("1 Industrial Way");
    expect(r.postcode).toBe("TF1 1AA");
  });

  it("falls back to the customer address when the site is bare", () => {
    const r = resolveSheetAddress(bare, customerAddr);
    expect(r.source).toBe("customer");
    expect(r.address_line_1).toBe("22 Garden Lane");
    expect(r.postcode).toBe("TF2 2BB");
  });

  it("prefers the site even if the customer also has one", () => {
    expect(resolveSheetAddress(siteAddr, customerAddr).source).toBe("site");
  });

  it("is 'none' when neither has a usable address", () => {
    const r = resolveSheetAddress(bare, {
      ...customerAddr,
      address_line_1: null,
      town: null,
    });
    expect(r.source).toBe("none");
    expect(r.address_line_1).toBeNull();
  });

  it("needs BOTH line 1 and town to be usable (line-1-only site falls back)", () => {
    const r = resolveSheetAddress(
      { ...bare, address_line_1: "1 Industrial Way" },
      customerAddr
    );
    expect(r.source).toBe("customer");
  });

  it("handles null site / null customer defensively", () => {
    expect(resolveSheetAddress(null, customerAddr).source).toBe("customer");
    expect(resolveSheetAddress(siteAddr, null).source).toBe("site");
    expect(resolveSheetAddress(null, null).source).toBe("none");
  });
});

describe("formatSheetAddress", () => {
  it("joins line 1, town, postcode", () => {
    expect(formatSheetAddress(resolveSheetAddress(siteAddr, null))).toBe(
      "1 Industrial Way, Testford, TF1 1AA"
    );
  });

  it("is empty for a 'none' resolution", () => {
    expect(formatSheetAddress(resolveSheetAddress(null, null))).toBe("");
  });
});
