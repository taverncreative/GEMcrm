/**
 * emailLibraryDocumentAction — emails a static library document as an
 * attachment to a validated multi-recipient list. Exercises the real
 * sendLibraryDocument helper (which downloads any reports-bucket object by
 * path and attaches it), pinning: the attachment carries the document's own
 * filename, its bytes are the downloaded object, and all recipients land on
 * one send.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn(
  async (_payload: {
    to: string[];
    attachments?: Array<{ filename: string; content: Buffer }>;
  }): Promise<{ data: { id: string } | null; error: { message: string } | null }> => ({
    data: { id: "msg1" },
    error: null,
  })
);
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const downloadMock = vi.fn(
  async (): Promise<{ data: Blob | null; error: { message: string } | null }> => ({
    data: new Blob([Buffer.from("%PDF-1.4 fake")]),
    error: null,
  })
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

const getDocMock = vi.fn(async (_id: string) => ({
  id: "doc-1",
  label: "Pest Control Record",
  file_path: "library/doc-1/Pest Control Record.pdf",
  file_name: "Pest Control Record.pdf",
}));
vi.mock("@/lib/data/library-documents", () => ({
  getLibraryDocumentById: (...a: unknown[]) =>
    (getDocMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { emailLibraryDocumentAction } from "@/app/(app)/library/actions";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <nate@gemservices.uk>";
  sendMock.mockClear();
  downloadMock.mockClear();
  downloadMock.mockResolvedValue({
    data: new Blob([Buffer.from("%PDF-1.4 fake")]),
    error: null,
  });
  getDocMock.mockClear();
});

describe("emailLibraryDocumentAction", () => {
  it("attaches the document under its own filename, to all recipients", async () => {
    const res = await emailLibraryDocumentAction("doc-1", [
      "a@example.com",
      "b@example.com",
    ]);
    expect(res.success).toBe(true);
    expect(res.emailedTo).toBe("a@example.com, b@example.com");

    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments![0].filename).toBe("Pest Control Record.pdf");
    expect(Buffer.from(payload.attachments![0].content).toString()).toContain(
      "%PDF-1.4"
    );
  });

  it("rejects an invalid recipient before sending", async () => {
    const res = await emailLibraryDocumentAction("doc-1", ["not-an-email"]);
    expect(res.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when the file can't be downloaded (no link-only fallback)", async () => {
    downloadMock.mockResolvedValue({
      data: null,
      error: { message: "missing" },
    });
    const res = await emailLibraryDocumentAction("doc-1", ["a@example.com"]);
    expect(res.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
