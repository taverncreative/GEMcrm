import { describe, it, expect } from "vitest";
import { storageObjectPath, proxyAssetUrl } from "@/lib/storage/asset-url";

/**
 * H1 — the reports bucket is private; every in-app consumer rewrites a
 * stored asset reference to the auth-gated proxy via proxyAssetUrl. These
 * are the invariants the display + email + PDF paths all rely on.
 */

const PUB =
  "https://ubyiiffkfqfzffigahrk.supabase.co/storage/v1/object/public/reports/photos/abc.jpg";
const SIGN =
  "https://ubyiiffkfqfzffigahrk.supabase.co/storage/v1/object/sign/reports/reports/00028.pdf?token=xyz";
const PROXY = "/api/storage/reports/photos/abc.jpg";
const DATA = "data:image/png;base64,AAAA";

describe("storageObjectPath", () => {
  it("extracts the object path from a legacy public URL", () => {
    expect(storageObjectPath(PUB)).toBe("photos/abc.jpg");
  });

  it("extracts from a signed URL and strips the query", () => {
    expect(storageObjectPath(SIGN)).toBe("reports/00028.pdf");
  });

  it("is idempotent on an already-proxied URL", () => {
    expect(storageObjectPath(PROXY)).toBe("photos/abc.jpg");
  });

  it("accepts a bare path", () => {
    expect(storageObjectPath("photos/abc.jpg")).toBe("photos/abc.jpg");
  });

  it("returns null for data URIs and empties", () => {
    expect(storageObjectPath(DATA)).toBeNull();
    expect(storageObjectPath("")).toBeNull();
    expect(storageObjectPath(null)).toBeNull();
    expect(storageObjectPath(undefined)).toBeNull();
  });
});

describe("proxyAssetUrl", () => {
  it("rewrites a public URL to the auth-gated proxy path", () => {
    expect(proxyAssetUrl(PUB)).toBe("/api/storage/reports/photos/abc.jpg");
  });

  it("passes data URIs through unchanged (inline signatures)", () => {
    expect(proxyAssetUrl(DATA)).toBe(DATA);
  });

  it("is idempotent — re-proxying yields the same URL", () => {
    expect(proxyAssetUrl(proxyAssetUrl(PUB))).toBe(proxyAssetUrl(PUB));
  });

  it("returns null for null/empty", () => {
    expect(proxyAssetUrl(null)).toBeNull();
    expect(proxyAssetUrl("")).toBeNull();
  });

  it("never emits a public-object URL for a reports asset", () => {
    const out = proxyAssetUrl(PUB);
    expect(out).not.toContain("/object/public/");
    expect(out?.startsWith("/api/storage/reports/")).toBe(true);
  });
});
