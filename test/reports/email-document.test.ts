/**
 * emailDocumentAction — email ANY stored document from the Documents list.
 *
 * Pins:
 *   - each kind attaches its own file, under a name that says what it is;
 *   - a QUOTE whose PDF has never been generated (quote_pdf_url null) is
 *     rendered on the fly and sent — a document must never fail to email just
 *     because nobody has downloaded it yet;
 *   - the same holds for a STALE stored URL (row points at a missing object);
 *   - an invalid recipient HARD-BLOCKS the whole send (nothing goes out);
 *   - a genuinely unloadable document reports an error rather than sending an
 *     email with nothing attached.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn(
  async (_payload: {
    to: string[];
    subject: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }): Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }> => ({ data: { id: "msg1" }, error: null })
);
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const downloadMock = vi.fn(
  async (): Promise<{
    data: Blob | null;
    error: { message: string } | null;
  }> => ({ data: new Blob([Buffer.from("%PDF-1.4 stored")]), error: null })
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

const getDocMock = vi.fn();
vi.mock("@/lib/data/documents", () => ({
  getDocumentForEmail: (...a: unknown[]) =>
    (getDocMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

const renderQuoteMock = vi.fn(async (_id: string) => ({
  pdfUrl: "https://storage.test/reports/quotes/q1/quote.pdf",
  buffer: Buffer.from("%PDF-1.4 freshly-rendered-quote"),
}));
vi.mock("@/lib/services/quote-pdf", () => ({
  renderAndStoreQuotePdf: (...a: unknown[]) =>
    (renderQuoteMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { emailDocumentAction } from "@/app/(app)/reports/actions";

const STORED =
  "https://storage.test/storage/v1/object/public/reports/reports/j1/sheet.pdf";

function attachment() {
  return sendMock.mock.calls[0][0].attachments?.[0];
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <reports@gemservices.uk>";
  delete process.env.RESEND_BCC;
  sendMock.mockClear();
  downloadMock.mockClear();
  downloadMock.mockResolvedValue({
    data: new Blob([Buffer.from("%PDF-1.4 stored")]),
    error: null,
  });
  getDocMock.mockReset();
  renderQuoteMock.mockClear();
});

describe("attaches the right file for each kind", () => {
  it("a service sheet sends its stored PDF", async () => {
    getDocMock.mockResolvedValue({
      kind: "service_sheet",
      id: "r1",
      pdfUrl: STORED,
      label: "Service Sheet GEM-1042",
      fileName: "Service Sheet GEM-1042.pdf",
    });

    const res = await emailDocumentAction("service_sheet", "r1", [
      "site@example.test",
    ]);

    expect(res.success).toBe(true);
    expect(getDocMock).toHaveBeenCalledWith("service_sheet", "r1");
    expect(sendMock.mock.calls[0][0].to).toEqual(["site@example.test"]);
    expect(attachment()?.filename).toBe("Service Sheet GEM-1042.pdf");
    expect(attachment()?.content.toString()).toContain("stored");
    // Nothing generated — the stored PDF was there.
    expect(renderQuoteMock).not.toHaveBeenCalled();
  });

  it("an agreement sends its stored contract PDF", async () => {
    getDocMock.mockResolvedValue({
      kind: "agreement",
      id: "a1",
      pdfUrl: STORED,
      label: "Agreement AGR-7",
      fileName: "Agreement AGR-7.pdf",
    });

    const res = await emailDocumentAction("agreement", "a1", [
      "office@example.test",
      "manager@example.test",
    ]);

    expect(res.success).toBe(true);
    // Multi-recipient: one send, both addresses on it.
    expect(sendMock.mock.calls[0][0].to).toEqual([
      "office@example.test",
      "manager@example.test",
    ]);
    expect(attachment()?.filename).toBe("Agreement AGR-7.pdf");
  });

  it("the subject names the document, not 'Your Service Report'", async () => {
    getDocMock.mockResolvedValue({
      kind: "agreement",
      id: "a1",
      pdfUrl: STORED,
      label: "Agreement AGR-7",
      fileName: "Agreement AGR-7.pdf",
    });
    await emailDocumentAction("agreement", "a1", ["a@example.test"]);
    expect(sendMock.mock.calls[0][0].subject).toContain("Agreement AGR-7");
  });
});

describe("a quote whose PDF has never been generated", () => {
  it("renders it on the fly, then sends the fresh bytes", async () => {
    getDocMock.mockResolvedValue({
      kind: "quote",
      id: "q1",
      pdfUrl: null, // never downloaded — lazy generation hasn't happened
      label: "Quote QUO-1042",
      fileName: "Quote QUO-1042.pdf",
    });

    const res = await emailDocumentAction("quote", "q1", ["lead@example.test"]);

    expect(res.success).toBe(true);
    expect(renderQuoteMock).toHaveBeenCalledWith("q1");
    // Never tried to download an object that doesn't exist yet.
    expect(downloadMock).not.toHaveBeenCalled();
    expect(attachment()?.filename).toBe("Quote QUO-1042.pdf");
    expect(attachment()?.content.toString()).toContain("freshly-rendered-quote");
  });

  it("also covers a STALE stored URL (object gone)", async () => {
    getDocMock.mockResolvedValue({
      kind: "quote",
      id: "q1",
      pdfUrl: STORED,
      label: "Quote QUO-1042",
      fileName: "Quote QUO-1042.pdf",
    });
    downloadMock.mockResolvedValue({ data: null, error: { message: "404" } });

    const res = await emailDocumentAction("quote", "q1", ["lead@example.test"]);

    expect(res.success).toBe(true);
    expect(renderQuoteMock).toHaveBeenCalledWith("q1");
    expect(attachment()?.content.toString()).toContain("freshly-rendered-quote");
  });

});

describe("guards", () => {
  it("an invalid recipient hard-blocks the send", async () => {
    getDocMock.mockResolvedValue({
      kind: "service_sheet",
      id: "r1",
      pdfUrl: STORED,
      label: "Service Sheet GEM-1042",
      fileName: "Service Sheet GEM-1042.pdf",
    });

    const res = await emailDocumentAction("service_sheet", "r1", [
      "good@example.test",
      "not-an-email",
    ]);

    expect(res.success).toBe(false);
    expect(res.message).toContain("not-an-email");
    // Nothing went out — not even to the valid address.
    expect(sendMock).not.toHaveBeenCalled();
    // And we never even looked the document up.
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it("an empty recipient list is refused", async () => {
    const res = await emailDocumentAction("quote", "q1", []);
    expect(res.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a sheet whose stored PDF can't be loaded errors instead of sending", async () => {
    getDocMock.mockResolvedValue({
      kind: "service_sheet",
      id: "r1",
      pdfUrl: STORED,
      label: "Service Sheet GEM-1042",
      fileName: "Service Sheet GEM-1042.pdf",
    });
    downloadMock.mockResolvedValue({ data: null, error: { message: "404" } });

    const res = await emailDocumentAction("service_sheet", "r1", [
      "site@example.test",
    ]);

    expect(res.success).toBe(false);
    expect(res.message).toContain("Could not load");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a missing document is reported, not sent", async () => {
    getDocMock.mockResolvedValue(null);
    const res = await emailDocumentAction("quote", "nope", ["a@example.test"]);
    expect(res.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
