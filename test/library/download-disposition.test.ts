/**
 * The storage proxy's download behaviour for the library:
 *   - `?download=1` → Content-Disposition: attachment, filename = the
 *     object's basename (so a library Download saves the original name);
 *   - no query → inline (unchanged for every existing consumer);
 *   - the Content-Type honours the library's extended type map (docx here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const downloadMock = vi.fn(async () => ({
  data: new Blob([Buffer.from("bytes")]),
  error: null as { message: string } | null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { GET } from "@/app/api/storage/reports/[...path]/route";

function call(url: string, path: string[]) {
  return GET(new Request(url), { params: Promise.resolve({ path }) });
}

beforeEach(() => {
  downloadMock.mockClear();
  downloadMock.mockResolvedValue({
    data: new Blob([Buffer.from("bytes")]),
    error: null,
  });
});

describe("download disposition", () => {
  it("?download=1 → attachment with the object basename", async () => {
    const res = await call(
      "https://app.test/api/storage/reports/library/id1/Site%20Rules.docx?download=1",
      ["library", "id1", "Site Rules.docx"]
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Site Rules.docx"'
    );
    // Office MIME comes from the library's extended map.
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("no query → inline (existing behaviour preserved)", async () => {
    const res = await call(
      "https://app.test/api/storage/reports/reports/job1/report.pdf",
      ["reports", "job1", "report.pdf"]
    );
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });
});
