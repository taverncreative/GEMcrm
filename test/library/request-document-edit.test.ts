/**
 * requestDocumentEditAction — "Request edit" on a library document.
 *
 * Rides the FEEDBACK plumbing (feature_requests row → inbox email →
 * fire-and-forget sendFeedbackToSpotlight), deliberately NOT a new endpoint:
 * feedback is the ingest we know exists and answers with a real ACK.
 *
 * Pins the thing John actually needs: the message must name the document AND
 * carry its stable id, so a renamed document is still identifiable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDocMock = vi.fn(async (id: string) => ({
  id,
  created_at: "2026-07-20T09:00:00Z",
  updated_at: "2026-07-20T09:00:00Z",
  deleted_at: null,
  label: "Site Rules",
  category: "Health & Safety",
  file_name: "site-rules-v3.pdf",
  file_path: "library/site-rules-v3.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  uploaded_by: null,
}));
vi.mock("@/lib/data/library-documents", () => ({
  getLibraryDocumentById: (...a: unknown[]) =>
    (getDocMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  softDeleteLibraryDocument: vi.fn(async () => {}),
}));

const createFeatureRequestMock = vi.fn(async (input: Record<string, unknown>) => ({
  id: "req-uuid-77",
  created_at: "2026-07-25T09:00:00Z",
  status: "pending" as const,
  submitter_email: null,
  ...input,
}));
vi.mock("@/lib/data/feature-requests", () => ({
  createFeatureRequest: (...a: unknown[]) =>
    (createFeatureRequestMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
}));

const sendEmailMock = vi.fn(async () => ({ success: true, id: "stub" }));
vi.mock("@/lib/services/email", () => ({
  sendEmail: (...a: unknown[]) =>
    (sendEmailMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  sendLibraryDocument: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/data/print-orders", () => ({
  createPrintOrder: vi.fn(async () => ({})),
  markPrintOrderDelivered: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown | Promise<unknown>) => {
    afterCallbacks.push(cb);
  },
}));
async function runAfter(): Promise<void> {
  const cbs = afterCallbacks.splice(0);
  for (const cb of cbs) await cb();
}

import { requestDocumentEditAction } from "@/app/(app)/library/actions";

const DOC_ID = "doc-uuid-1";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SPOTLIGHT_INGEST_URL = "https://spotlight.test/api/inbound/feedback";
  process.env.SPOTLIGHT_INGEST_TOKEN = "tok_abc";
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true, id: "sp_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  getDocMock.mockClear();
  createFeatureRequestMock.mockClear();
  sendEmailMock.mockClear();
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the request identifies WHICH document", () => {
  it("sends the label AND the stable document id in the message", async () => {
    const res = await requestDocumentEditAction(DOC_ID);
    expect(res.success).toBe(true);

    const message = (
      createFeatureRequestMock.mock.calls[0][0] as { message: string }
    ).message;
    expect(message).toContain("Site Rules");
    expect(message).toContain(DOC_ID);
    expect(message).toContain("site-rules-v3.pdf");

    await runAfter();
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    // Same message reaches Spotlight, over the FEEDBACK endpoint.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://spotlight.test/api/inbound/feedback"
    );
    expect(body.message).toContain("Site Rules");
    expect(body.message).toContain(DOC_ID);
  });

  it("includes the operator's note when given, and omits the line when not", async () => {
    await requestDocumentEditAction(DOC_ID, "  phone number on page 2 is old  ");
    expect(
      (createFeatureRequestMock.mock.calls[0][0] as { message: string }).message
    ).toContain("phone number on page 2 is old");

    createFeatureRequestMock.mockClear();
    await requestDocumentEditAction(DOC_ID, "   ");
    expect(
      (createFeatureRequestMock.mock.calls[0][0] as { message: string }).message
    ).not.toContain("What needs changing");
  });

  it("logs it as a 'change' request and uses the row id as the idempotency key", async () => {
    await requestDocumentEditAction(DOC_ID);
    expect(
      (createFeatureRequestMock.mock.calls[0][0] as { request_type: string })
        .request_type
    ).toBe("change");
    await runAfter();
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.request_id).toBe("req-uuid-77");
    expect(body.type).toBe("change");
  });
});

describe("fire-and-forget, same fence as feedback", () => {
  it("returns success before the POST fires", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const res = await requestDocumentEditAction(DOC_ID);
    expect(res.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });

  it("still succeeds when Spotlight is unreachable, and the email backstop ran", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await requestDocumentEditAction(DOC_ID);
    expect(res.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    await expect(runAfter()).resolves.toBeUndefined();
  });

  it("still succeeds when Spotlight answers 200-with-HTML", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>404</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );
    expect((await requestDocumentEditAction(DOC_ID)).success).toBe(true);
    await expect(runAfter()).resolves.toBeUndefined();
  });
});

describe("guards", () => {
  it("rejects a missing id and an unknown document, writing nothing", async () => {
    expect((await requestDocumentEditAction("")).success).toBe(false);
    getDocMock.mockResolvedValueOnce(null as never);
    const res = await requestDocumentEditAction("ghost");
    expect(res.success).toBe(false);
    expect(res.message).toBe("Document not found");
    expect(createFeatureRequestMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});
