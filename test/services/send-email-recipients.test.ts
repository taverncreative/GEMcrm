/**
 * The widened sendEmail `to` — accepts a single string OR an array, and
 * delivers all recipients in ONE Resend send. Resend is mocked and
 * RESEND_API_KEY is set so the real (non-stub) path runs; we assert the
 * `to` payload Resend receives.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn(
  async (
    _payload: { to: string[] }
  ): Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }> => ({ data: { id: "msg1" }, error: null })
);
vi.mock("resend", () => ({
  // Must be constructable (`new Resend(key)`), so a class, not an arrow fn.
  Resend: class {
    emails = { send: sendMock };
  },
}));
// email.ts imports the admin client for signed links; sendEmail itself
// never calls it, but stub the module so importing doesn't touch Supabase.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { sendEmail } from "@/lib/services/email";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "GEM Services <nate@gemservices.uk>";
  sendMock.mockClear();
});

describe("sendEmail — recipient widening", () => {
  it("a single string becomes a one-element `to` array", async () => {
    const res = await sendEmail({ to: "a@x.com", subject: "s", text: "b" });
    expect(res.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual(["a@x.com"]);
  });

  it("an array delivers all recipients in one send (trimmed)", async () => {
    const res = await sendEmail({
      to: ["a@x.com", " b@x.com "],
      subject: "s",
      text: "b",
    });
    expect(res.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("an invalid address in the array blocks the whole send", async () => {
    const res = await sendEmail({
      to: ["a@x.com", "bad"],
      subject: "s",
      text: "b",
    });
    expect(res.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("an empty array is rejected", async () => {
    const res = await sendEmail({ to: [], subject: "s", text: "b" });
    expect(res.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
