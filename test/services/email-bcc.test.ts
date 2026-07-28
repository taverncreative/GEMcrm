/**
 * RESEND_BCC — the blind copy on customer-facing mail.
 *
 * Customer mail is addressed to the CUSTOMER, so the operator never received
 * a copy of what his own system sent (which is exactly how "I'm not getting
 * the service records" happened). This env var puts one in his inbox.
 *
 * Pins:
 *   - bcc rides the Resend payload when RESEND_BCC is set;
 *   - it is OMITTED entirely when unset/blank — behaviour is exactly as it
 *     was before, which is what makes shipping this safe;
 *   - it applies across the customer-facing senders (report, agreement,
 *     agreement review, document attachment);
 *   - internal mail (the developer-inbox / feedback shape) is NOT copied;
 *   - it is a BCC, never a To — the customer must not see the address.
 *
 * Resend is mocked and RESEND_API_KEY set so the real (non-stub) path runs;
 * we assert the payload Resend actually receives.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Customer } from "@/types/database";

const sendMock = vi.fn(
  async (_payload: {
    from: string;
    to: string[];
    bcc?: string;
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/sign/${path}?token=tok` },
          error: null,
        }),
        download: async () => ({
          data: new Blob([Buffer.from("%PDF-1.4 x")]),
          error: null,
        }),
      }),
    },
  }),
}));

import {
  sendEmail,
  sendServiceReport,
  sendAgreement,
  sendAgreementReview,
  sendDocumentAttachment,
} from "@/lib/services/email";

const customer = {
  id: "c1",
  name: "Edna",
  email: "edna@example.test",
} as Customer;
const PDF_URL =
  "https://storage.test/storage/v1/object/public/reports/reports/j1/service-sheet.pdf";
const BCC = "nate@gemservices.uk";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <reports@gemservices.uk>";
  // Explicitly unset per test — a leaked value would make a passing
  // "BCC present" assertion meaningless.
  delete process.env.RESEND_BCC;
  delete process.env.RESEND_REPLY_TO;
  sendMock.mockClear();
});

describe("RESEND_BCC drives the blind copy", () => {
  it("rides the payload when the env var is set", async () => {
    process.env.RESEND_BCC = BCC;
    const res = await sendEmail({
      to: "a@x.com",
      subject: "s",
      text: "b",
      bcc: true,
    });
    expect(res.success).toBe(true);
    expect(sendMock.mock.calls[0][0].bcc).toBe(BCC);
  });

  it("is OMITTED when the env var is unset (today's behaviour)", async () => {
    const res = await sendEmail({
      to: "a@x.com",
      subject: "s",
      text: "b",
      bcc: true,
    });
    expect(res.success).toBe(true);
    expect("bcc" in sendMock.mock.calls[0][0]).toBe(false);
  });

  it("is OMITTED when the env var is blank or whitespace", async () => {
    process.env.RESEND_BCC = "   ";
    await sendEmail({ to: "a@x.com", subject: "s", text: "b", bcc: true });
    expect("bcc" in sendMock.mock.calls[0][0]).toBe(false);
  });

  it("trims the env value", async () => {
    process.env.RESEND_BCC = `  ${BCC}  `;
    await sendEmail({ to: "a@x.com", subject: "s", text: "b", bcc: true });
    expect(sendMock.mock.calls[0][0].bcc).toBe(BCC);
  });

  it("never leaks into the To — the customer must not see it", async () => {
    process.env.RESEND_BCC = BCC;
    await sendEmail({ to: "a@x.com", subject: "s", text: "b", bcc: true });
    expect(sendMock.mock.calls[0][0].to).toEqual(["a@x.com"]);
  });

  it("is NOT applied to a send that doesn't opt in (internal mail)", async () => {
    process.env.RESEND_BCC = BCC;
    // The shape the feedback / edit-request / developer-inbox sends use:
    // already addressed to us, so it must not be copied.
    await sendEmail({
      to: "john@example.test",
      subject: "[CRM] feedback",
      text: "b",
    });
    expect("bcc" in sendMock.mock.calls[0][0]).toBe(false);
  });
});

describe("the BCC applies across the customer-facing senders", () => {
  beforeEach(() => {
    process.env.RESEND_BCC = BCC;
  });

  it("the service report carries it", async () => {
    await sendServiceReport(customer, PDF_URL, undefined, "2026-07-23");
    expect(sendMock.mock.calls[0][0].bcc).toBe(BCC);
  });

  it("the signed agreement carries it", async () => {
    await sendAgreement(customer, PDF_URL, undefined, "AGR-1");
    expect(sendMock.mock.calls[0][0].bcc).toBe(BCC);
  });

  it("the agreement review copy carries it", async () => {
    await sendAgreementReview(customer, PDF_URL, undefined, "AGR-1");
    expect(sendMock.mock.calls[0][0].bcc).toBe(BCC);
  });

  it("an emailed document (quote, sheet, agreement, invoice) carries it", async () => {
    await sendDocumentAttachment(
      ["someone@example.test"],
      Buffer.from("%PDF-1.4 q"),
      "Quote QUO-1042.pdf",
      "Quote QUO-1042"
    );
    expect(sendMock.mock.calls[0][0].bcc).toBe(BCC);
  });
});

describe("with RESEND_BCC unset, the senders behave exactly as before", () => {
  it("no sender adds a bcc key", async () => {
    await sendServiceReport(customer, PDF_URL, undefined, "2026-07-23");
    await sendAgreement(customer, PDF_URL, undefined, "AGR-1");
    await sendAgreementReview(customer, PDF_URL, undefined, "AGR-1");
    await sendDocumentAttachment(
      ["someone@example.test"],
      Buffer.from("%PDF"),
      "Quote.pdf",
      "Quote"
    );
    expect(sendMock).toHaveBeenCalledTimes(4);
    for (const [payload] of sendMock.mock.calls) {
      expect("bcc" in payload).toBe(false);
    }
  });
});
