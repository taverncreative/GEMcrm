/**
 * Feedback polish — the three fixes, pinned:
 *
 * 1. submitFeatureRequestAction must NOT call revalidatePath. In this Next
 *    version a broad revalidate from a server action purges the whole
 *    client router cache and stampedes a re-prefetch of every link on the
 *    current page — the confirmed cause of slow 2nd/3rd submits. The
 *    Settings list refreshes via a scoped client-side router.refresh()
 *    instead, so the action itself invalidates nothing.
 *
 * 2. Every successful submit returns a fresh `submittedAt` (ISO) so the
 *    form can render a per-submit timestamped confirmation and re-run its
 *    highlight — a repeat submit must be visibly different from the first.
 *
 * 3. delete / clear-all are requireUser-gated hard deletes that also
 *    revalidate nothing (same stampede rule; the caller refreshes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createFeatureRequestMock = vi.fn(async () => ({
  id: "row-uuid-123",
  created_at: "2026-07-18T10:00:00Z",
  request_type: "bug",
  message: "The routine card date is wrong",
  status: "pending" as const,
  submitter_email: null,
}));
const deleteFeatureRequestMock = vi.fn(async () => undefined);
const clearFeatureRequestsMock = vi.fn(async () => 3);
vi.mock("@/lib/data/feature-requests", () => ({
  createFeatureRequest: (...a: unknown[]) =>
    (createFeatureRequestMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  deleteFeatureRequest: (...a: unknown[]) =>
    (deleteFeatureRequestMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  clearFeatureRequests: (...a: unknown[]) =>
    (clearFeatureRequestsMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  getRecentFeatureRequests: vi.fn(async () => []),
}));

const sendEmailMock = vi.fn(async () => ({ success: true, id: "stub" }));
vi.mock("@/lib/services/email", () => ({
  sendEmail: (...a: unknown[]) =>
    (sendEmailMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

const requireUserMock = vi.fn(async () => ({ id: "op" }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: (...a: unknown[]) =>
    (requireUserMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { revalidatePath } from "next/cache";
import {
  clearFeatureRequestsAction,
  deleteFeatureRequestAction,
  submitFeatureRequestAction,
} from "@/app/(app)/settings/actions";

function formData(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base = {
    request_type: "bug",
    message: "The routine card date is wrong",
    submitter_email: "dev@gemcrm.local",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

const initial = { success: false, errors: {}, message: null };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "op" });
  deleteFeatureRequestMock.mockResolvedValue(undefined);
  clearFeatureRequestsMock.mockResolvedValue(3);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submit revalidates NOTHING (the stampede fix)", () => {
  it("a successful submit never calls revalidatePath", async () => {
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a failed submit doesn't either", async () => {
    await submitFeatureRequestAction(initial, formData({ message: "hi" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("submittedAt — the per-submit confirmation signal", () => {
  it("is returned on success as the submit-time ISO timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T14:03:22.500Z"));
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
    expect(res.submittedAt).toBe("2026-07-18T14:03:22.500Z");
  });

  it("changes on every submit, so a repeat is visibly distinct", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T14:03:22.500Z"));
    const first = await submitFeatureRequestAction(initial, formData());
    vi.setSystemTime(new Date("2026-07-18T14:03:29.100Z"));
    const second = await submitFeatureRequestAction(initial, formData());
    expect(first.submittedAt).toBeDefined();
    expect(second.submittedAt).toBeDefined();
    expect(second.submittedAt).not.toBe(first.submittedAt);
  });

  it("is absent when validation fails — no false confirmation", async () => {
    const res = await submitFeatureRequestAction(initial, formData({ message: "hi" }));
    expect(res.success).toBe(false);
    expect(res.submittedAt).toBeUndefined();
  });
});

describe("deleteFeatureRequestAction", () => {
  it("hard-deletes the given row and reports success", async () => {
    const res = await deleteFeatureRequestAction("row-uuid-123");
    expect(deleteFeatureRequestMock).toHaveBeenCalledTimes(1);
    expect(deleteFeatureRequestMock).toHaveBeenCalledWith("row-uuid-123");
    expect(res.success).toBe(true);
  });

  it("revalidates nothing — the caller refreshes the Settings page", async () => {
    await deleteFeatureRequestAction("row-uuid-123");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces a data-layer failure as {success:false}", async () => {
    deleteFeatureRequestMock.mockRejectedValue(
      new Error("Failed to delete request: boom")
    );
    const res = await deleteFeatureRequestAction("row-uuid-123");
    expect(res.success).toBe(false);
    expect(res.message).toContain("Failed to delete request");
  });

  it("is auth-gated: an unauthenticated caller deletes nothing", async () => {
    // requireUser redirects (throws) when there's no session; the throw
    // must propagate BEFORE the data layer is touched.
    const redirectErr = new Error("NEXT_REDIRECT");
    requireUserMock.mockRejectedValue(redirectErr);
    await expect(deleteFeatureRequestAction("row-uuid-123")).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(deleteFeatureRequestMock).not.toHaveBeenCalled();
  });
});

describe("clearFeatureRequestsAction", () => {
  it("clears every row and reports how many went", async () => {
    const res = await clearFeatureRequestsAction();
    expect(clearFeatureRequestsMock).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.message).toBe("Cleared 3 requests.");
  });

  it("an already-empty list reads naturally", async () => {
    clearFeatureRequestsMock.mockResolvedValue(0);
    const res = await clearFeatureRequestsAction();
    expect(res.success).toBe(true);
    expect(res.message).toBe("Nothing to clear.");
  });

  it("revalidates nothing", async () => {
    await clearFeatureRequestsAction();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is auth-gated: an unauthenticated caller clears nothing", async () => {
    requireUserMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(clearFeatureRequestsAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(clearFeatureRequestsMock).not.toHaveBeenCalled();
  });
});
