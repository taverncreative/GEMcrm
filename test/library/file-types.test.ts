/**
 * Library file-type rules — the allow-list, the MIME map (incl. the Office
 * types the library adds over the reports proxy's original pdf/image set),
 * and the filename sanitiser that produces safe Storage object names.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  contentTypeForPath,
  isAllowedUpload,
  prettyType,
  sanitizeFileName,
} from "@/lib/library/file-types";

describe("allow-list", () => {
  it("accepts PDF, Word, Excel, and images", () => {
    for (const name of [
      "a.pdf",
      "b.doc",
      "c.docx",
      "d.xls",
      "e.xlsx",
      "f.png",
      "g.jpg",
      "h.jpeg",
      "i.webp",
      "j.gif",
    ]) {
      expect(isAllowedUpload(name)).toBe(true);
    }
  });

  it("rejects unsupported and extension-less files", () => {
    expect(isAllowedUpload("virus.exe")).toBe(false);
    expect(isAllowedUpload("script.js")).toBe(false);
    expect(isAllowedUpload("noext")).toBe(false);
  });

  it("covers the Office extensions in the allow-list", () => {
    for (const ext of ["docx", "xlsx"]) {
      expect(ALLOWED_EXTENSIONS).toContain(ext);
    }
  });

  it("caps uploads at 25 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("content types (drives download / email MIME)", () => {
  it("maps the Office + image + pdf extensions", () => {
    expect(contentTypeForPath("library/x/report.pdf")).toBe("application/pdf");
    expect(contentTypeForPath("a.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(contentTypeForPath("a.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(contentTypeForPath("a.png")).toBe("image/png");
    expect(contentTypeForPath("a.jpg")).toBe("image/jpeg");
  });

  it("unknown extension → octet-stream", () => {
    expect(contentTypeForPath("a.zip")).toBe("application/octet-stream");
  });
});

describe("sanitizeFileName", () => {
  it("strips path components and hostile characters, keeps a readable name", () => {
    expect(sanitizeFileName("Method Statement (v2).pdf")).toBe(
      "Method Statement (v2).pdf"
    );
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName('bad:"name"?.pdf')).toBe("badname.pdf");
  });

  it("keeps digits (a naive range would have eaten them)", () => {
    expect(sanitizeFileName("2026-report-01.pdf")).toBe("2026-report-01.pdf");
  });

  it("falls back to 'document' when nothing usable remains", () => {
    expect(sanitizeFileName("???")).toBe("document");
  });
});

describe("prettyType", () => {
  it("labels the kinds", () => {
    expect(prettyType("a.pdf")).toBe("PDF");
    expect(prettyType("a.docx")).toBe("Word");
    expect(prettyType("a.xlsx")).toBe("Excel");
    expect(prettyType("a.png")).toBe("Image");
  });
});
