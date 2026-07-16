/**
 * finaliseDraftAgreementAction + discardDraftAgreementAction +
 * the updateAgreementStatusAction draft guard (Slice 2).
 *
 * Pins:
 *   - finalise rejects anything not currently a draft (so a SECOND
 *     finalise attempt, when the row is already active, fails cleanly);
 *   - finalise uploads both signatures, updates the row to active with
 *     signed_date, THEN generates visits once, THEN writes the SIGNED
 *     contract.pdf over the review URL, THEN auto-sends to the customer;
 *   - missing signatures are rejected before any write;
 *   - discard soft-deletes a draft and refuses a non-draft;
 *   - the old Activate status path cannot flip a draft active.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const getAgreementWithContextMock = vi.fn();
const getAgreementByIdMock = vi.fn();
const updateAgreementStatusMock = vi.fn(async () => ({}));
const softDeleteAgreementMock = vi.fn(async () => undefined);
const generateAgreementJobsMock = vi.fn(async (_a: { status: string }) => undefined);
const generateAgreementPdfMock = vi.fn(
  async (_opts: { mode?: string }) => Buffer.from("pdf")
);
const uploadPdfMock = vi.fn(
  async (_buf: Buffer, _path: string) =>
    "https://x/reports/agreements/a1/contract.pdf"
);
const uploadBase64ImageMock = vi.fn(
  async (_b64: string, path: string) => `https://x/reports/${path}`
);
const sendAgreementMock = vi.fn(
  async (_customer: unknown, _url: string) => ({ success: true })
);

// Supabase server client: update().eq() must serve BOTH chains —
// `.select().single()` (the finalise row-update) and a bare await (the
// contract_pdf_url write). Record every update payload for assertions.
const updatePayloads: Array<Record<string, unknown>> = [];
let updatedRow: Record<string, unknown> = {};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updatePayloads.push(payload);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({ data: updatedRow, error: null }),
            }),
            then: (resolve: (v: { error: null }) => void) =>
              resolve({ error: null }),
          }),
        };
      },
    }),
  })),
}));
vi.mock("@/lib/data/agreements", () => ({
  getAgreementWithContext: (...a: unknown[]) =>
    (getAgreementWithContextMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  getAgreementById: (...a: unknown[]) =>
    (getAgreementByIdMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  updateAgreementStatus: (...a: unknown[]) =>
    (updateAgreementStatusMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  softDeleteAgreement: (...a: unknown[]) =>
    (softDeleteAgreementMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/data/customers", () => ({ getCustomerById: vi.fn() }));
vi.mock("@/lib/services/email", () => ({
  sendAgreement: (...a: unknown[]) =>
    (sendAgreementMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  sendAgreementReview: vi.fn(),
}));
vi.mock("@/lib/services/agreement-events", () => ({
  generateAgreementJobs: (...a: unknown[]) =>
    (generateAgreementJobsMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/pdf/generate-agreement-pdf", () => ({
  generateAgreementPdf: (...a: unknown[]) =>
    (generateAgreementPdfMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: (...a: unknown[]) =>
    (uploadPdfMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  uploadBase64Image: (...a: unknown[]) =>
    (uploadBase64ImageMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  finaliseDraftAgreementAction,
  discardDraftAgreementAction,
  updateAgreementStatusAction,
} from "@/app/(app)/agreements/[id]/actions";

const DRAFT = {
  id: "a1",
  status: "draft",
  site_id: "s1",
  customer_id: "c1",
  contract_pdf_url: "https://x/reports/agreements/a1/review.pdf",
  customer: { id: "c1", name: "Acme", email: "owner@acme.test" },
  site: { id: "s1", address_line_1: "5 Cafe Row" },
};

const SIGS = {
  client_signature: "data:image/png;base64,CLIENT",
  gem_signature: "data:image/png;base64,GEM",
  client_signatory_name: "Jane Owner",
  signed_date: "2026-07-16",
};

beforeEach(() => {
  vi.clearAllMocks();
  updatePayloads.length = 0;
  getAgreementWithContextMock.mockResolvedValue(DRAFT);
  getAgreementByIdMock.mockResolvedValue(DRAFT);
  updatedRow = { ...DRAFT, status: "active", signed_date: "2026-07-16" };
  sendAgreementMock.mockResolvedValue({ success: true });
});

describe("finaliseDraftAgreementAction", () => {
  it("rejects a non-draft (second finalise attempt)", async () => {
    getAgreementWithContextMock.mockResolvedValue({ ...DRAFT, status: "active" });
    const res = await finaliseDraftAgreementAction("a1", SIGS);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/draft/i);
    expect(uploadBase64ImageMock).not.toHaveBeenCalled();
    expect(generateAgreementJobsMock).not.toHaveBeenCalled();
  });

  it("rejects missing signatures before any write", async () => {
    const res = await finaliseDraftAgreementAction("a1", {
      ...SIGS,
      client_signature: "",
    });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/client signature/i);
    expect(uploadBase64ImageMock).not.toHaveBeenCalled();
    expect(updatePayloads).toHaveLength(0);
  });

  it("happy path: signatures up, row active + signed_date, visits once, signed PDF replaces review, auto-send", async () => {
    const res = await finaliseDraftAgreementAction("a1", SIGS);
    expect(res.success).toBe(true);

    // Both signatures land in the sign-now storage slots.
    expect(uploadBase64ImageMock).toHaveBeenCalledWith(
      SIGS.client_signature,
      "agreements/a1/client.png"
    );
    expect(uploadBase64ImageMock).toHaveBeenCalledWith(
      SIGS.gem_signature,
      "agreements/a1/gem.png"
    );

    // Row update: active + signed_date + signatory + both URLs.
    const rowUpdate = updatePayloads[0];
    expect(rowUpdate.status).toBe("active");
    expect(rowUpdate.signed_date).toBe("2026-07-16");
    expect(rowUpdate.client_signatory_name).toBe("Jane Owner");
    expect(rowUpdate.client_signature_url).toContain("client.png");
    expect(rowUpdate.gem_signature_url).toContain("gem.png");

    // Visits generated exactly once, from the UPDATED (active) agreement.
    expect(generateAgreementJobsMock).toHaveBeenCalledTimes(1);
    expect(generateAgreementJobsMock.mock.calls[0][0].status).toBe("active");

    // Signed PDF (mode signed) written over contract.pdf, URL persisted.
    expect(generateAgreementPdfMock).toHaveBeenCalledTimes(1);
    expect(generateAgreementPdfMock.mock.calls[0][0]).toMatchObject({
      mode: "signed",
    });
    expect(uploadPdfMock).toHaveBeenCalledWith(
      expect.anything(),
      "agreements/a1/contract.pdf"
    );
    expect(updatePayloads[1]).toEqual({
      contract_pdf_url: "https://x/reports/agreements/a1/contract.pdf",
    });

    // Auto-send to the customer email.
    expect(sendAgreementMock).toHaveBeenCalledTimes(1);
    expect(sendAgreementMock.mock.calls[0][1]).toBe(
      "https://x/reports/agreements/a1/contract.pdf"
    );
  });

  it("defaults signed_date to today when blank", async () => {
    const res = await finaliseDraftAgreementAction("a1", {
      ...SIGS,
      signed_date: "",
    });
    expect(res.success).toBe(true);
    expect(updatePayloads[0].signed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("no customer email: finalises without sending", async () => {
    getAgreementWithContextMock.mockResolvedValue({
      ...DRAFT,
      customer: { ...DRAFT.customer, email: null },
    });
    const res = await finaliseDraftAgreementAction("a1", SIGS);
    expect(res.success).toBe(true);
    expect(sendAgreementMock).not.toHaveBeenCalled();
  });
});

describe("discardDraftAgreementAction", () => {
  it("soft-deletes a draft", async () => {
    const res = await discardDraftAgreementAction("a1");
    expect(res.success).toBe(true);
    expect(softDeleteAgreementMock).toHaveBeenCalledWith("a1");
  });

  it("refuses a non-draft", async () => {
    getAgreementByIdMock.mockResolvedValue({ ...DRAFT, status: "active" });
    const res = await discardDraftAgreementAction("a1");
    expect(res.success).toBe(false);
    expect(softDeleteAgreementMock).not.toHaveBeenCalled();
  });
});

describe("updateAgreementStatusAction — draft guard", () => {
  function fd(values: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.append(k, v);
    return f;
  }

  it("cannot flip a DRAFT active (finalise is the only path)", async () => {
    getAgreementByIdMock.mockResolvedValue(DRAFT);
    const res = await updateAgreementStatusAction(
      { success: false, errors: {}, message: null },
      fd({ agreement_id: "a1", status: "active" })
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/finalised/i);
    expect(updateAgreementStatusMock).not.toHaveBeenCalled();
  });

  it("still works for non-draft statuses", async () => {
    getAgreementByIdMock.mockResolvedValue({ ...DRAFT, status: "paused" });
    const res = await updateAgreementStatusAction(
      { success: false, errors: {}, message: null },
      fd({ agreement_id: "a1", status: "active" })
    );
    expect(res.success).toBe(true);
    expect(updateAgreementStatusMock).toHaveBeenCalledWith("a1", "active");
  });
});
