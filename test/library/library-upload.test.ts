/**
 * handleLibraryUpload — the upload core: it must store the file in the
 * reports bucket at library/<id>/<name> AND write the library_documents row
 * with the matching path, and reject unsupported types / oversize files
 * before touching storage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ upload: uploadMock }) },
  }),
}));

const createLibraryDocumentMock = vi.fn(
  async (input: Record<string, unknown>) => ({ ...input, created_at: "t", updated_at: "t" })
);
vi.mock("@/lib/data/library-documents", () => ({
  createLibraryDocument: (...a: unknown[]) =>
    (createLibraryDocumentMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("@/lib/utils/id", () => ({ newId: () => "fixed-id-1" }));

import { handleLibraryUpload, type UploadFile } from "@/lib/library/upload";
import { MAX_UPLOAD_BYTES } from "@/lib/library/file-types";

function file(over: Partial<UploadFile> = {}): UploadFile {
  return {
    name: "Method Statement.pdf",
    type: "application/pdf",
    size: 1024,
    arrayBuffer: async () => new ArrayBuffer(8),
    ...over,
  };
}

beforeEach(() => {
  uploadMock.mockClear();
  uploadMock.mockResolvedValue({ error: null });
  createLibraryDocumentMock.mockClear();
});

describe("happy path", () => {
  it("uploads to library/<id>/<name> and writes the matching row", async () => {
    const res = await handleLibraryUpload({
      label: "  Method Statement  ",
      category: "Health & Safety",
      file: file(),
      uploadedBy: "nate@gemservices.uk",
    });

    expect(res.ok).toBe(true);
    // Stored at the id-scoped path.
    const [path] = uploadMock.mock.calls[0] as unknown as [string];
    expect(path).toBe("library/fixed-id-1/Method Statement.pdf");
    // Row written with the SAME id + path (id doubles as Spotlight reference).
    const row = createLibraryDocumentMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.id).toBe("fixed-id-1");
    expect(row.file_path).toBe("library/fixed-id-1/Method Statement.pdf");
    expect(row.file_name).toBe("Method Statement.pdf");
    expect(row.label).toBe("Method Statement");
    expect(row.category).toBe("Health & Safety");
    expect(row.uploaded_by).toBe("nate@gemservices.uk");
  });
});

describe("rejections happen before storage is touched", () => {
  it("415 for an unsupported type", async () => {
    const res = await handleLibraryUpload({
      label: "x",
      file: file({ name: "malware.exe" }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(415);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createLibraryDocumentMock).not.toHaveBeenCalled();
  });

  it("413 for an oversize file", async () => {
    const res = await handleLibraryUpload({
      label: "x",
      file: file({ size: MAX_UPLOAD_BYTES + 1 }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(413);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("400 for a missing label", async () => {
    const res = await handleLibraryUpload({ label: "   ", file: file() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
