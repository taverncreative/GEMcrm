/**
 * deleteQuoteAction (app/(app)/quotes/actions.ts). Pins:
 *   - it is auth-gated (requireUser) BEFORE any delete;
 *   - it soft-deletes via the data layer's softDeleteQuote (the soft_delete_quote
 *     RPC path), never a raw update;
 *   - an unauthenticated call never reaches the RPC;
 *   - an RPC failure surfaces as a message, not a throw.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const softDeleteQuoteMock = vi.fn(async (_id: string) => undefined);
const requireUserMock = vi.fn(async () => ({ id: "op-1" }));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock("@/lib/data/quotes", () => ({
  createQuote: vi.fn(),
  softDeleteQuote: (id: string) => softDeleteQuoteMock(id),
}));
vi.mock("@/lib/services/quote-pdf", () => ({ renderAndStoreQuotePdf: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { deleteQuoteAction } from "@/app/(app)/quotes/actions";

beforeEach(() => {
  softDeleteQuoteMock.mockClear();
  softDeleteQuoteMock.mockResolvedValue(undefined);
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op-1" });
});

describe("deleteQuoteAction", () => {
  it("gates on auth, then soft-deletes via the RPC path", async () => {
    const res = await deleteQuoteAction("quote-9");
    expect(requireUserMock).toHaveBeenCalledTimes(1); // auth gate
    expect(softDeleteQuoteMock).toHaveBeenCalledWith("quote-9"); // RPC path
    expect(res.success).toBe(true);
  });

  it("never reaches the RPC when unauthenticated (requireUser rejects)", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("redirect to /login"));
    await expect(deleteQuoteAction("quote-9")).rejects.toThrow();
    expect(softDeleteQuoteMock).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure as a message, not a throw", async () => {
    softDeleteQuoteMock.mockRejectedValueOnce(new Error("42501 denied"));
    const res = await deleteQuoteAction("quote-9");
    expect(res.success).toBe(false);
    expect(res.message).toContain("42501");
  });

  it("rejects a missing id without calling the RPC", async () => {
    const res = await deleteQuoteAction("");
    expect(res.success).toBe(false);
    expect(softDeleteQuoteMock).not.toHaveBeenCalled();
  });
});
