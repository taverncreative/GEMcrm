import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression — service-sheet image/PDF uploads must go through the
 * service-role admin client, NOT the user-JWT SSR client.
 *
 * The `reports` bucket is private with an INSERT policy scoped to
 * `authenticated` only, and the anon INSERT policy stays REMOVED (H1's
 * PII fix). On the field sync-replay path the user token doesn't
 * reliably reach the Storage API, so a user-client upload arrives as
 * anon and is rejected with 42501 "new row violates row-level security
 * policy" — that is Nate Green's failure. Every caller of these helpers
 * is already behind a requireUser()-gated server action, so routing the
 * write through the admin client is safe. If anyone reverts to the
 * server client, these tests fail.
 */

// Hoisted so the vi.mock factories (which are hoisted to the top of the
// file) can reference these without a TDZ error.
const {
  uploadMock,
  getPublicUrlMock,
  fromMock,
  createAdminClientMock,
  createServerClientMock,
} = vi.hoisted(() => {
  const uploadMock = vi.fn(
    async (): Promise<{ error: { message: string } | null }> => ({
      error: null,
    })
  );
  const getPublicUrlMock = vi.fn(() => ({
    data: { publicUrl: "https://example.test/reports/x" },
  }));
  const fromMock = vi.fn(() => ({
    upload: uploadMock,
    getPublicUrl: getPublicUrlMock,
  }));
  const createAdminClientMock = vi.fn(() => ({ storage: { from: fromMock } }));
  // The user-JWT SSR client MUST NOT be used for uploads. If it is, the
  // test blows up loudly at the .from() call rather than silently passing.
  const createServerClientMock = vi.fn(async () => ({
    storage: {
      from: () => {
        throw new Error(
          "user-JWT server client must not be used for reports-bucket uploads"
        );
      },
    },
  }));
  return {
    uploadMock,
    getPublicUrlMock,
    fromMock,
    createAdminClientMock,
    createServerClientMock,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: createServerClientMock,
}));

import { uploadBase64Image, uploadPdf } from "@/lib/storage/upload";

beforeEach(() => {
  uploadMock.mockClear();
  fromMock.mockClear();
  createAdminClientMock.mockClear();
  createServerClientMock.mockClear();
});

describe("lib/storage/upload — writes use the service-role admin client", () => {
  it("uploadBase64Image uploads via the admin client, never the SSR client", async () => {
    const url = await uploadBase64Image(
      "data:image/png;base64,AAAA",
      "signatures/job-1/technician.png"
    );

    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("reports");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://example.test/reports/x");
  });

  it("uploadPdf uploads via the admin client, never the SSR client", async () => {
    const url = await uploadPdf(
      Buffer.from("%PDF-1.4"),
      "reports/job-1/service-sheet.pdf"
    );

    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("reports");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://example.test/reports/x");
  });

  it("surfaces the RLS/storage error instead of swallowing it", async () => {
    uploadMock.mockResolvedValueOnce({
      error: { message: "new row violates row-level security policy" },
    });

    await expect(
      uploadBase64Image("data:image/png;base64,AAAA", "signatures/job-2/c.png")
    ).rejects.toThrow(/row-level security/);
  });
});
