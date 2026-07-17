/**
 * Reply-To, driven by RESEND_REPLY_TO.
 *
 * The From is a systematic address (reports@…) so automated mail doesn't
 * read as personal mail; Reply-To points replies at a real inbox so a
 * customer hitting Reply still reaches a human, and so a reply can't bounce
 * off an address with no mailbox behind it.
 *
 * Pins:
 *   - reply_to rides the Resend payload when RESEND_REPLY_TO is set;
 *   - it is OMITTED entirely when unset/blank (the pre-existing behaviour,
 *     and the safe default — never an empty header);
 *   - it applies across ALL senders, not just the primitive;
 *   - a per-call replyTo overrides the env.
 *
 * Resend is mocked and RESEND_API_KEY is set so the real (non-stub) path
 * runs; we assert the payload Resend actually receives. The SDK takes
 * camelCase `replyTo` and puts `reply_to` on the wire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Customer, Invoice } from "@/types/database";

const sendMock = vi.fn(
  async (_payload: {
    from: string;
    to: string[];
    replyTo?: string | string[];
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

// email.ts reaches for the admin client to sign links + download the PDF
// attachment. Stub both so the senders run without touching Supabase.
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

import { sendEmail, sendServiceReport, sendAgreement } from "@/lib/services/email";
import { sendInvoiceEmail } from "@/lib/services/invoice-email";

const customer = { id: "c1", name: "Edna", email: "edna@example.test" } as Customer;
const PDF_URL =
  "https://storage.test/storage/v1/object/public/reports/reports/j1/service-sheet.pdf";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <reports@gemservices.uk>";
  // Explicitly unset per test — set it only where the test needs it, so a
  // leaked value can never make a passing assertion meaningless.
  delete process.env.RESEND_REPLY_TO;
  sendMock.mockClear();
});

describe("RESEND_REPLY_TO drives Reply-To", () => {
  it("rides the payload when the env var is set", async () => {
    process.env.RESEND_REPLY_TO = "nate@gemservices.uk";
    const res = await sendEmail({ to: "a@x.com", subject: "s", text: "b" });
    expect(res.success).toBe(true);
    expect(sendMock.mock.calls[0][0].replyTo).toBe("nate@gemservices.uk");
  });

  it("is OMITTED when the env var is unset (today's behaviour)", async () => {
    const res = await sendEmail({ to: "a@x.com", subject: "s", text: "b" });
    expect(res.success).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.replyTo).toBeUndefined();
    expect("replyTo" in payload).toBe(false);
  });

  it("is OMITTED when the env var is blank or whitespace", async () => {
    process.env.RESEND_REPLY_TO = "   ";
    await sendEmail({ to: "a@x.com", subject: "s", text: "b" });
    expect("replyTo" in sendMock.mock.calls[0][0]).toBe(false);
  });

  it("trims the env value", async () => {
    process.env.RESEND_REPLY_TO = "  nate@gemservices.uk  ";
    await sendEmail({ to: "a@x.com", subject: "s", text: "b" });
    expect(sendMock.mock.calls[0][0].replyTo).toBe("nate@gemservices.uk");
  });

  it("a per-call replyTo overrides the env", async () => {
    process.env.RESEND_REPLY_TO = "nate@gemservices.uk";
    await sendEmail({
      to: "a@x.com",
      subject: "s",
      text: "b",
      replyTo: "someone-else@gemservices.uk",
    });
    expect(sendMock.mock.calls[0][0].replyTo).toBe("someone-else@gemservices.uk");
  });

  it("accepts an array", async () => {
    await sendEmail({
      to: "a@x.com",
      subject: "s",
      text: "b",
      replyTo: ["a@gemservices.uk", "b@gemservices.uk"],
    });
    expect(sendMock.mock.calls[0][0].replyTo).toEqual([
      "a@gemservices.uk",
      "b@gemservices.uk",
    ]);
  });

  it("does not disturb the From, which stays RESEND_FROM_EMAIL", async () => {
    process.env.RESEND_REPLY_TO = "nate@gemservices.uk";
    await sendEmail({ to: "a@x.com", subject: "s", text: "b" });
    expect(sendMock.mock.calls[0][0].from).toBe(
      "GEM Services <reports@gemservices.uk>"
    );
  });
});

describe("Reply-To applies across ALL senders", () => {
  beforeEach(() => {
    process.env.RESEND_REPLY_TO = "nate@gemservices.uk";
  });

  it("the service report inherits it", async () => {
    await sendServiceReport(customer, PDF_URL, undefined, "2026-07-23");
    expect(sendMock.mock.calls[0][0].replyTo).toBe("nate@gemservices.uk");
  });

  it("the agreement inherits it", async () => {
    await sendAgreement(customer, PDF_URL, undefined, "AGR-1");
    expect(sendMock.mock.calls[0][0].replyTo).toBe("nate@gemservices.uk");
  });

  it("the invoice inherits it (it delegates to sendEmail)", async () => {
    const invoice = {
      id: "abcdef12-0000-4000-8000-000000000000",
      invoice_number: "00042",
      amount: 120,
      due_date: "2026-08-01",
    } as Invoice;
    await sendInvoiceEmail(customer, invoice, PDF_URL);
    expect(sendMock.mock.calls[0][0].replyTo).toBe("nate@gemservices.uk");
  });
});
