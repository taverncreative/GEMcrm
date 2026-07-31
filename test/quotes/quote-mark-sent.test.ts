/**
 * Marking a quote sent.
 *
 * quotes.status is 'draft' from creation and nothing moved it before this;
 * now a real email marks it 'sent'. The marking lives INSIDE
 * emailDocumentAction, past its success check, which is what guarantees:
 *
 *   - every entry point marks it (quote detail AND the Documents list run
 *     the same action — there is no second send path to forget);
 *   - a FAILED send never marks it;
 *   - a non-quote document never touches quotes at all;
 *   - a status-write failure does NOT report the send as failed, because the
 *     email has already gone: reporting failure would invite a duplicate send
 *     to the customer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn(
  async (): Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }> => ({ data: { id: "msg1" }, error: null })
);
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([Buffer.from("%PDF-1.4 x")]),
          error: null,
        }),
      }),
    },
  }),
}));

const getDocMock = vi.fn();
vi.mock("@/lib/data/documents", () => ({
  getDocumentForEmail: (...a: unknown[]) =>
    (getDocMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

const markSentMock = vi.fn(async (_id: string) => {});
vi.mock("@/lib/data/quotes", () => ({
  markQuoteSent: (...a: unknown[]) =>
    (markSentMock as unknown as (...x: unknown[]) => Promise<void>)(...a),
}));

vi.mock("@/lib/services/quote-pdf", () => ({
  renderAndStoreQuotePdf: vi.fn(async () => ({
    pdfUrl: "https://storage.test/reports/quotes/q1/quote.pdf",
    buffer: Buffer.from("%PDF-1.4 fresh"),
  })),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { emailDocumentAction } from "@/app/(app)/reports/actions";

const STORED =
  "https://storage.test/storage/v1/object/public/reports/quotes/q1/quote.pdf";

const quoteDoc = {
  kind: "quote",
  id: "q1",
  pdfUrl: STORED,
  label: "Quote QUO-1042",
  fileName: "Quote QUO-1042.pdf",
};

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <reports@gemservices.uk>";
  sendMock.mockClear();
  sendMock.mockResolvedValue({ data: { id: "msg1" }, error: null });
  getDocMock.mockReset();
  markSentMock.mockClear();
  markSentMock.mockResolvedValue(undefined);
});

describe("a successful quote send marks it sent", () => {
  it("marks the quote", async () => {
    getDocMock.mockResolvedValue(quoteDoc);
    const res = await emailDocumentAction("quote", "q1", ["lead@example.test"]);
    expect(res.success).toBe(true);
    expect(markSentMock).toHaveBeenCalledWith("q1");
  });

  it("marks it whichever entry point sent it — there is one action", async () => {
    // The quote detail page and the Documents list both call this same
    // action with the same arguments; nothing about the caller is passed in,
    // so neither can silently skip the status update.
    getDocMock.mockResolvedValue(quoteDoc);
    await emailDocumentAction("quote", "q1", ["a@example.test"]);
    await emailDocumentAction("quote", "q1", ["b@example.test"]);
    expect(markSentMock).toHaveBeenCalledTimes(2);
    expect(markSentMock).toHaveBeenNthCalledWith(1, "q1");
    expect(markSentMock).toHaveBeenNthCalledWith(2, "q1");
  });
});

describe("a failed send leaves the quote alone", () => {
  it("does NOT mark when Resend rejects", async () => {
    getDocMock.mockResolvedValue(quoteDoc);
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "domain not verified" },
    });
    const res = await emailDocumentAction("quote", "q1", ["lead@example.test"]);
    expect(res.success).toBe(false);
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("does NOT mark when the recipient is invalid (blocked before sending)", async () => {
    const res = await emailDocumentAction("quote", "q1", ["not-an-email"]);
    expect(res.success).toBe(false);
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("does NOT mark when the quote can't be found", async () => {
    getDocMock.mockResolvedValue(null);
    const res = await emailDocumentAction("quote", "nope", ["a@example.test"]);
    expect(res.success).toBe(false);
    expect(markSentMock).not.toHaveBeenCalled();
  });
});

describe("blast radius", () => {
  it("a non-quote document never touches quote status", async () => {
    getDocMock.mockResolvedValue({
      kind: "service_sheet",
      id: "r1",
      pdfUrl: STORED,
      label: "Service Sheet GEM-1",
      fileName: "Service Sheet GEM-1.pdf",
    });
    const res = await emailDocumentAction("service_sheet", "r1", [
      "site@example.test",
    ]);
    expect(res.success).toBe(true);
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("a status-write failure still reports the send as SUCCESSFUL", async () => {
    // The email is already delivered at this point. Reporting failure would
    // invite Nate to send the customer a second copy.
    getDocMock.mockResolvedValue(quoteDoc);
    markSentMock.mockRejectedValue(new Error("db down"));
    const res = await emailDocumentAction("quote", "q1", ["lead@example.test"]);
    expect(res.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
