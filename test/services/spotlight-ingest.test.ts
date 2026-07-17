/**
 * Spotlight ingest — the outbound POST, and above all its FENCE.
 *
 * The fence is the point of these tests. Nate's request is already logged
 * (row written, email sent) before Spotlight is contacted, so a Spotlight
 * outage MUST NOT surface as "Failed to submit request" — he'd resubmit
 * something already recorded and duplicate it downstream. Every failure
 * mode below therefore asserts the action still returns success.
 *
 * Also pins the contract John specified: bearer auth, request_id = the
 * created row id (Spotlight's idempotency key), and NO source_app (the
 * token identifies the app).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createFeatureRequestMock = vi.fn(
  async (input: { request_type: string; message: string }) => ({
    id: "row-uuid-123",
    created_at: "2026-07-17T10:00:00Z",
    status: "pending" as const,
    submitter_email: null,
    ...input,
  })
);
vi.mock("@/lib/data/feature-requests", () => ({
  createFeatureRequest: (...a: unknown[]) =>
    (createFeatureRequestMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
  getRecentFeatureRequests: vi.fn(async () => []),
}));

const sendEmailMock = vi.fn(async () => ({ success: true, id: "stub" }));
vi.mock("@/lib/services/email", () => ({
  // Lazy indirection — vi.mock is hoisted above the const, so the factory
  // must not read sendEmailMock at evaluation time, only at call time.
  sendEmail: (...a: unknown[]) =>
    (sendEmailMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { submitFeatureRequestAction } from "@/app/(app)/settings/actions";

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
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SPOTLIGHT_INGEST_URL = "https://spotlight.test/api/inbound/feedback";
  process.env.SPOTLIGHT_INGEST_TOKEN = "tok_abc";
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  createFeatureRequestMock.mockClear();
  sendEmailMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the POST fires with the right body + auth", () => {
  it("posts to the configured URL with a bearer token", async () => {
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://spotlight.test/api/inbound/feedback");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_abc"
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("request_id is the created row id (Spotlight's idempotency key)", async () => {
    await submitFeatureRequestAction(initial, formData());
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.request_id).toBe("row-uuid-123");
    expect(body.message).toBe("The routine card date is wrong");
    expect(body.type).toBe("bug");
    expect(body.client_name).toBe("Nate Green");
  });

  it("does NOT send source_app — the token identifies the app", async () => {
    await submitFeatureRequestAction(initial, formData());
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect("source_app" in body).toBe(false);
  });
});

describe("THE FENCE — Spotlight can never fail Nate's submit", () => {
  it("still succeeds when the POST rejects (unreachable)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
    expect(res.message).toBe("Thanks — request logged.");
  });

  it("still succeeds when Spotlight returns 401", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
  });

  it("still succeeds when Spotlight returns 400 or 500", async () => {
    fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
    expect((await submitFeatureRequestAction(initial, formData())).success).toBe(true);
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await submitFeatureRequestAction(initial, formData())).success).toBe(true);
  });

  it("still succeeds when the POST times out (aborted)", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      // Mimic fetch's abort behaviour rather than actually waiting 5s.
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      if (init?.signal?.aborted) throw err;
      throw err;
    });
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
  });

  it("the row and the email still happen regardless of Spotlight", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    await submitFeatureRequestAction(initial, formData());
    expect(createFeatureRequestMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});

describe("skipped when unconfigured", () => {
  it("no POST when the URL is unset — submit still works", async () => {
    delete process.env.SPOTLIGHT_INGEST_URL;
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("no POST when the token is unset", async () => {
    delete process.env.SPOTLIGHT_INGEST_TOKEN;
    const res = await submitFeatureRequestAction(initial, formData());
    expect(res.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("validation still gates before anything is sent", () => {
  it("a too-short message posts nothing and writes nothing", async () => {
    const res = await submitFeatureRequestAction(initial, formData({ message: "hi" }));
    expect(res.success).toBe(false);
    expect(createFeatureRequestMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
