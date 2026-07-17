/**
 * PDF attachments on the customer-facing emails (belt and braces: the
 * attachment for the non-technical recipient, the signed link kept as
 * the always-current fallback). Pins:
 *   - each sender attaches the downloaded PDF under its exact filename
 *     (job-date / reference variants) while keeping the signed link;
 *   - a failed download degrades to EXACTLY the link-only email — the
 *     send never fails because of the attachment (the offline replay
 *     path's email step must never strand);
 *   - the link button reads "View online copy";
 *   - the invoice email routes its PDF URL through signedEmailLink
 *     (the raw private-bucket URL was a dead link).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Customer, Invoice } from "@/types/database";

const sendMock = vi.fn(
  async (_payload: {
    to: string[];
    html?: string;
    text?: string;
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

// One admin client for both storage calls email.ts makes: createSignedUrl
// (the link) and download (the attachment). Both are per-test switchable.
const createSignedUrlMock = vi.fn(async (path: string, _ttl: number) => ({
  data: {
    signedUrl: `https://storage.test/object/sign/reports/${path}?token=tok123`,
  },
  error: null,
}));
const downloadMock = vi.fn(
  async (
    _path: string
  ): Promise<{ data: Blob | null; error: { message: string } | null }> => ({
    data: new Blob([Buffer.from("%PDF-1.4 fake body")]),
    error: null,
  })
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: createSignedUrlMock,
        download: downloadMock,
      }),
    },
  }),
}));

import {
  sendServiceReport,
  sendAgreement,
  sendAgreementReview,
} from "@/lib/services/email";
import { sendInvoiceEmail } from "@/lib/services/invoice-email";

const customer = {
  id: "cust1",
  name: "Edna Testly",
  email: "edna@example.test",
} as Customer;

const PDF_URL =
  "https://storage.test/storage/v1/object/public/reports/reports/job1/service-sheet.pdf";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <nate@gemservices.uk>";
  sendMock.mockClear();
  createSignedUrlMock.mockClear();
  downloadMock.mockClear();
  downloadMock.mockImplementation(async () => ({
    data: new Blob([Buffer.from("%PDF-1.4 fake body")]),
    error: null,
  }));
});

describe("service report email — attachment + link", () => {
  it("attaches the PDF named by job date and keeps the signed link", async () => {
    const res = await sendServiceReport(
      customer,
      PDF_URL,
      undefined,
      "2026-07-23"
    );
    expect(res.success).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments![0].filename).toBe(
      "Service Report - 23 July 2026.pdf"
    );
    expect(
      Buffer.from(payload.attachments![0].content).toString()
    ).toContain("%PDF-1.4");
    // The signed link survives alongside the attachment.
    expect(payload.html).toContain("token=tok123");
    expect(payload.html).toContain("View online copy");
  });

  it("no job date → plain filename", async () => {
    await sendServiceReport(customer, PDF_URL);
    expect(sendMock.mock.calls[0][0].attachments![0].filename).toBe(
      "Service Report.pdf"
    );
  });

  it("failed download → exactly the link-only email, send still succeeds", async () => {
    downloadMock.mockImplementation(async () => ({
      data: null,
      error: { message: "Object not found" },
    }));
    const res = await sendServiceReport(
      customer,
      PDF_URL,
      undefined,
      "2026-07-23"
    );
    expect(res.success).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.attachments).toBeUndefined();
    expect(payload.html).toContain("token=tok123");
  });
});

describe("agreement emails — attachment + link", () => {
  it("signed agreement attaches under 'Agreement - <reference>.pdf'", async () => {
    const res = await sendAgreement(
      customer,
      PDF_URL,
      undefined,
      "AGR-0007"
    );
    expect(res.success).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.attachments![0].filename).toBe("Agreement - AGR-0007.pdf");
    expect(payload.html).toContain("token=tok123");
    expect(payload.html).toContain("View online copy");
  });

  it("review copy attaches under 'Agreement for review - <reference>.pdf'", async () => {
    await sendAgreementReview(customer, PDF_URL, undefined, "AGR-0007");
    expect(sendMock.mock.calls[0][0].attachments![0].filename).toBe(
      "Agreement for review - AGR-0007.pdf"
    );
  });

  it("no reference → plain filenames", async () => {
    await sendAgreement(customer, PDF_URL);
    await sendAgreementReview(customer, PDF_URL);
    expect(sendMock.mock.calls[0][0].attachments![0].filename).toBe(
      "Agreement.pdf"
    );
    expect(sendMock.mock.calls[1][0].attachments![0].filename).toBe(
      "Agreement for review.pdf"
    );
  });
});

describe("invoice email — dead-link fix", () => {
  const invoice = {
    id: "abcdef12-0000-4000-8000-000000000000",
    invoice_number: "00042",
    amount: 120,
    due_date: "2026-08-01",
  } as Invoice;

  it("routes the PDF URL through signedEmailLink", async () => {
    const res = await sendInvoiceEmail(customer, invoice, PDF_URL);
    expect(res.success).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.text).toContain("token=tok123");
    expect(payload.text).not.toContain("/object/public/");
    // Link-only by design — no attachment for invoices.
    expect(payload.attachments).toBeUndefined();
  });
});
