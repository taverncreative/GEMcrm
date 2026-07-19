/**
 * On-demand quote PDF route (app/api/pdf/quote/[id]/route.ts). Pins the lazy
 * cache behaviour that keeps create fast:
 *   - cache MISS (no stored PDF)      -> render + store, serve the fresh bytes;
 *   - stale URL (object gone)         -> re-render, serve;
 *   - cache HIT (stored + present)    -> serve cached, do NOT re-render;
 *   - unknown id                      -> 404.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type QuoteRow = { id: string; quote_pdf_url: string | null };

const getQuoteByIdMock = vi.fn(
  async (_id: string): Promise<QuoteRow | null> => null
);
const renderAndStoreMock = vi.fn(async (_id: string, _q?: unknown) => ({
  pdfUrl: "https://x/quotes/q1/quote.pdf",
  buffer: Buffer.from("%PDF-1.4 generated"),
}));
const downloadMock = vi.fn(async (_path: string) => ({
  data: null as { arrayBuffer: () => Promise<ArrayBuffer> } | null,
  error: null as unknown,
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/data/quotes", () => ({
  getQuoteById: (id: string) => getQuoteByIdMock(id),
}));
vi.mock("@/lib/services/quote-pdf", () => ({
  renderAndStoreQuotePdf: (id: string, q?: unknown) => renderAndStoreMock(id, q),
  quotePdfPath: (id: string) => `quotes/${id}/quote.pdf`,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ download: (p: string) => downloadMock(p) }) },
  }),
}));

import { GET } from "@/app/api/pdf/quote/[id]/route";

function call(id: string) {
  return GET(new Request(`http://localhost/api/pdf/quote/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  getQuoteByIdMock.mockReset();
  renderAndStoreMock.mockClear();
  downloadMock.mockReset();
});

describe("GET /api/pdf/quote/[id]", () => {
  it("404s for an unknown quote", async () => {
    getQuoteByIdMock.mockResolvedValue(null);
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(renderAndStoreMock).not.toHaveBeenCalled();
  });

  it("cache MISS (no stored PDF): renders on demand and serves the bytes", async () => {
    getQuoteByIdMock.mockResolvedValue({ id: "q1", quote_pdf_url: null });
    const res = await call("q1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(renderAndStoreMock).toHaveBeenCalledWith("q1", { id: "q1", quote_pdf_url: null });
    expect(downloadMock).not.toHaveBeenCalled(); // no cached object to try
  });

  it("cache HIT (stored + present): serves cached, does NOT re-render", async () => {
    getQuoteByIdMock.mockResolvedValue({
      id: "q1",
      quote_pdf_url: "https://x/object/public/reports/quotes/q1/quote.pdf",
    });
    downloadMock.mockResolvedValue({
      data: { arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer },
      error: null,
    });
    const res = await call("q1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(downloadMock).toHaveBeenCalledWith("quotes/q1/quote.pdf");
    expect(renderAndStoreMock).not.toHaveBeenCalled();
  });

  it("stale URL (object missing): re-renders and serves", async () => {
    getQuoteByIdMock.mockResolvedValue({
      id: "q1",
      quote_pdf_url: "https://x/object/public/reports/quotes/q1/quote.pdf",
    });
    downloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });
    const res = await call("q1");
    expect(res.status).toBe(200);
    expect(downloadMock).toHaveBeenCalled();
    expect(renderAndStoreMock).toHaveBeenCalledWith("q1", expect.objectContaining({ id: "q1" }));
  });
});
