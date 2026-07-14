/**
 * sendAgreementReviewAction — send the unsigned review copy of a DRAFT.
 * Pins: invalid recipients hard-block (no PDF work); non-draft is refused;
 * a valid draft renders the review-mode PDF, stores its URL, and sends.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const getAgreementWithContextMock = vi.fn();
const generateAgreementPdfMock = vi.fn(
  async (_opts: { mode?: string }) => Buffer.from("pdf")
);
const uploadPdfMock = vi.fn(async () => "reports/agreements/a1/review.pdf");
const sendAgreementReviewMock = vi.fn(
  async (_customer: unknown, _url: unknown, _emails: string[]) => ({
    success: true,
  })
);
const updateEqMock = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/data/agreements", () => ({
  getAgreementWithContext: (...a: unknown[]) =>
    (getAgreementWithContextMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  getAgreementById: vi.fn(),
  updateAgreementStatus: vi.fn(),
}));
vi.mock("@/lib/data/customers", () => ({ getCustomerById: vi.fn() }));
vi.mock("@/lib/services/email", () => ({
  sendAgreement: vi.fn(),
  sendAgreementReview: (...a: unknown[]) =>
    (sendAgreementReviewMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/pdf/generate-agreement-pdf", () => ({
  generateAgreementPdf: (...a: unknown[]) =>
    (generateAgreementPdfMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: (...a: unknown[]) =>
    (uploadPdfMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ update: () => ({ eq: (...a: unknown[]) => updateEqMock(...(a as [])) }) }),
  })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn(async () => ({ id: "op" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sendAgreementReviewAction } from "@/app/(app)/agreements/[id]/actions";

const DRAFT = {
  id: "a1",
  status: "draft",
  customer: { id: "c1", name: "Acme", email: "owner@acme.test" },
  site: { id: "s1", address_line_1: "5 Cafe Row" },
};

beforeEach(() => {
  getAgreementWithContextMock.mockReset();
  getAgreementWithContextMock.mockResolvedValue(DRAFT);
  generateAgreementPdfMock.mockClear();
  uploadPdfMock.mockClear();
  sendAgreementReviewMock.mockClear();
  sendAgreementReviewMock.mockResolvedValue({ success: true });
});

describe("sendAgreementReviewAction", () => {
  it("hard-blocks an invalid recipient and does no PDF work", async () => {
    const res = await sendAgreementReviewAction("a1", ["owner@acme.test", "not-an-email"]);
    expect(res.success).toBe(false);
    expect(res.message).toContain("not-an-email");
    expect(generateAgreementPdfMock).not.toHaveBeenCalled();
  });

  it("refuses a non-draft agreement", async () => {
    getAgreementWithContextMock.mockResolvedValue({ ...DRAFT, status: "active" });
    const res = await sendAgreementReviewAction("a1", ["owner@acme.test"]);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/draft/i);
    expect(generateAgreementPdfMock).not.toHaveBeenCalled();
  });

  it("renders the review PDF and sends it for a valid draft", async () => {
    const res = await sendAgreementReviewAction("a1", [
      "owner@acme.test",
      "second@acme.test",
    ]);
    expect(res.success).toBe(true);
    // Rendered in REVIEW mode.
    expect(generateAgreementPdfMock).toHaveBeenCalledTimes(1);
    expect(generateAgreementPdfMock.mock.calls[0][0]).toMatchObject({
      mode: "review",
    });
    expect(uploadPdfMock).toHaveBeenCalledWith(
      expect.anything(),
      "agreements/a1/review.pdf"
    );
    // Sent to the validated recipients via the review helper.
    expect(sendAgreementReviewMock).toHaveBeenCalledTimes(1);
    expect(sendAgreementReviewMock.mock.calls[0][2]).toEqual([
      "owner@acme.test",
      "second@acme.test",
    ]);
    expect(res.emailedTo).toBe("owner@acme.test, second@acme.test");
  });
});
