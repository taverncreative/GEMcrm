/**
 * Shared `isNetworkError` predicate — pins the cross-browser shapes
 * the helper claims to cover. Two consumers depend on this:
 *
 *   - lib/actions/graceful.ts  (form + direct-call wrappers)
 *   - app/(app)/error.tsx       (offline screen secondary signal)
 *
 * Production builds rely primarily on `useIsOnline() === false`
 * because Next.js sanitises server-component error messages — see
 * the docstring on `app/(app)/error.tsx`. This helper is the
 * secondary catch for the rare in-dev case where the raw message IS
 * available.
 */
import { describe, it, expect } from "vitest";
import { isNetworkError } from "@/lib/sync/is-network-error";

describe("isNetworkError", () => {
  it("Chrome 'Failed to fetch'", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("Node 'fetch failed' (Next.js server-side fetch)", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
  });

  it("Firefox 'NetworkError when attempting to fetch resource.'", () => {
    expect(
      isNetworkError(
        new TypeError("NetworkError when attempting to fetch resource.")
      )
    ).toBe(true);
  });

  it("Safari 'Load failed'", () => {
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("bare TypeError (Chrome throws TypeError for network failures)", () => {
    expect(isNetworkError(new TypeError("something opaque"))).toBe(true);
  });

  it("regular server-side Error does NOT match", () => {
    expect(
      isNetworkError(new Error("Database constraint violation"))
    ).toBe(false);
  });

  it("non-Error values do not match", () => {
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError("offline")).toBe(false);
    expect(isNetworkError({ message: "fetch failed" })).toBe(false);
  });
});
