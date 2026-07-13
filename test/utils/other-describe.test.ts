import { describe, it, expect } from "vitest";
import {
  OTHER_PILL,
  encodeOther,
  splitOther,
} from "@/lib/utils/other-describe";

/**
 * The "Other" free-text encode/split contract shared by the service
 * sheet and the booking/agreement pest selectors. These are the
 * invariants every one of those surfaces relies on, so drift here breaks
 * all of them at once.
 */

describe("encodeOther", () => {
  it("folds the description into the Other pill as 'Other: <desc>'", () => {
    expect(encodeOther(["Wasps", OTHER_PILL], "Cockroaches")).toEqual([
      "Wasps",
      "Other: Cockroaches",
    ]);
  });

  it("trims the description", () => {
    expect(encodeOther([OTHER_PILL], "  Silverfish  ")).toEqual([
      "Other: Silverfish",
    ]);
  });

  it("leaves a bare 'Other' when the description is empty (so callers can catch it)", () => {
    expect(encodeOther(["Rats", OTHER_PILL], "")).toEqual(["Rats", "Other"]);
    expect(encodeOther([OTHER_PILL], "   ")).toEqual(["Other"]);
  });

  it("leaves non-Other pills untouched", () => {
    expect(encodeOther(["Wasps", "Mice"], "ignored")).toEqual([
      "Wasps",
      "Mice",
    ]);
  });
});

describe("splitOther", () => {
  it("extracts the description and restores the bare Other pill", () => {
    expect(splitOther(["Wasps", "Other: Cockroaches"])).toEqual({
      pills: ["Wasps", OTHER_PILL],
      otherText: "Cockroaches",
    });
  });

  it("handles a bare 'Other' with no description", () => {
    expect(splitOther(["Mice", "Other"])).toEqual({
      pills: ["Mice", OTHER_PILL],
      otherText: "",
    });
  });

  it("tolerates no space after the colon", () => {
    expect(splitOther(["Other:Ants"])).toEqual({
      pills: [OTHER_PILL],
      otherText: "Ants",
    });
  });

  it("leaves arrays with no Other entry unchanged", () => {
    expect(splitOther(["Wasps", "Rats"])).toEqual({
      pills: ["Wasps", "Rats"],
      otherText: "",
    });
  });
});

describe("round-trip", () => {
  const cases: Array<{ pills: string[]; text: string }> = [
    { pills: ["Wasps", OTHER_PILL], text: "Cockroaches" },
    { pills: [OTHER_PILL], text: "German cockroaches (kitchen)" },
    { pills: ["Rats", "Mice"], text: "" },
    { pills: ["Birds", OTHER_PILL], text: "Pigeons: roof void" },
  ];

  it("splitOther(encodeOther(...)) returns the original pills + text", () => {
    for (const { pills, text } of cases) {
      const encoded = encodeOther(pills, text);
      const back = splitOther(encoded);
      expect(back.pills).toEqual(pills);
      // encode trims, so compare against the trimmed original.
      expect(back.otherText).toBe(text.trim());
    }
  });
});
