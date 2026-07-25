/**
 * A 2xx IS NOT DELIVERY — the regression test for the incident.
 *
 * Spotlight's prod answers unmatched paths with HTTP 200 carrying a Next.js
 * 404 HTML page. Their /api/inbound/print-order was never built, so every
 * order we sent got `res.ok === true` from a page that rendered "not found",
 * and we recorded delivered=true for orders that reached nobody.
 *
 * Delivery is now defined by the documented ACK — JSON `{ok:true, id,
 * duplicate}` — not the status line. These tests pin that:
 *
 *   - 200 + text/html            → FAILURE, reason names the content type
 *   - 200 + JSON without ok/id   → FAILURE
 *   - 200 + {ok:true, id}        → delivered
 *
 * Both senders share the check, so both are exercised here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  sendFeedbackToSpotlight,
  sendPrintOrderToSpotlight,
} from "@/lib/services/spotlight";

const FEEDBACK = {
  message: "The routine card date is wrong",
  request_id: "row-uuid-123",
};
const ORDER = {
  order_id: "11111111-1111-4111-8111-111111111111",
  items: [{ name: "Site Rules", quantity: 3, reference: "doc-a" }],
};

/** The exact thing Spotlight prod returned for the endpoint that was never
 *  built: 200, text/html, a Next 404 page. */
function next404Html(): Response {
  return new Response(
    "<!DOCTYPE html><html><body><h1>404</h1><p>This page could not be found.</p></body></html>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SPOTLIGHT_INGEST_URL = "https://spotlight.test/api/inbound/feedback";
  process.env.SPOTLIGHT_PRINT_ORDER_URL =
    "https://spotlight.test/api/inbound/print-order";
  process.env.SPOTLIGHT_INGEST_TOKEN = "tok_abc";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("200-with-HTML is a FAILURE, not a delivery (the incident)", () => {
  it("print order: rejects the Next 404 page and names the content type", async () => {
    fetchMock.mockResolvedValue(next404Html());
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("unexpected response type");
    expect(res.reason).toContain("text/html");
  });

  it("feedback: rejects the same response", async () => {
    fetchMock.mockResolvedValue(next404Html());
    const res = await sendFeedbackToSpotlight(FEEDBACK);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("text/html");
  });

  it("a 200 with NO content-type at all is a failure too", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("unexpected response type");
  });
});

describe("JSON that isn't the documented ACK is a failure", () => {
  it("rejects JSON missing both ok and id", async () => {
    fetchMock.mockResolvedValue(json({ status: "queued" }));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("unexpected response shape");
  });

  it("rejects {ok:true} with no id", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("missing id");
  });

  it("rejects {ok:false} even with an id", async () => {
    fetchMock.mockResolvedValue(json({ ok: false, id: "sp_1" }));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("ok not true");
  });

  it("rejects a JSON content-type with an unparseable body", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json at all", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("not JSON");
  });

  it("rejects a JSON array (object-shaped check)", async () => {
    fetchMock.mockResolvedValue(json([{ ok: true, id: "sp_1" }]));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
  });
});

describe("the real ACK is accepted", () => {
  it("print order: {ok:true, id, duplicate:false} → delivered", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, id: "sp_9", duplicate: false }));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("feedback: {ok:true, id, duplicate:true} → delivered (idempotent replay)", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, id: "sp_9", duplicate: true }));
    const res = await sendFeedbackToSpotlight(FEEDBACK);
    expect(res.delivered).toBe(true);
  });

  it("duplicate is NOT required — a first send without it still counts", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, id: "sp_9" }));
    expect((await sendPrintOrderToSpotlight(ORDER)).delivered).toBe(true);
  });

  it("a numeric id counts", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, id: 42 }));
    expect((await sendPrintOrderToSpotlight(ORDER)).delivered).toBe(true);
  });

  it("charset on the JSON content-type is fine", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, id: "sp_9" }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      })
    );
    expect((await sendPrintOrderToSpotlight(ORDER)).delivered).toBe(true);
  });
});

describe("non-2xx still fails first, by status", () => {
  it("a 500 reports the status, not the body shape", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await sendPrintOrderToSpotlight(ORDER);
    expect(res.delivered).toBe(false);
    expect(res.reason).toBe("HTTP 500");
  });

  it("a real 404 reports HTTP 404", async () => {
    fetchMock.mockResolvedValue(next404Html());
    // …but only when the status actually IS 404 — that's the point of the
    // incident: prod returned 200 for this body. Sanity-check the honest case.
    fetchMock.mockResolvedValue(
      new Response("<html>404</html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      })
    );
    expect((await sendPrintOrderToSpotlight(ORDER)).reason).toBe("HTTP 404");
  });
});

describe("still fire-and-forget — a bad ACK never throws", () => {
  it("resolves (never rejects) for every rejected shape", async () => {
    for (const r of [
      next404Html(),
      json({ ok: true }),
      json({ ok: false, id: "x" }),
      new Response("", { status: 200 }),
    ]) {
      fetchMock.mockResolvedValue(r);
      await expect(sendPrintOrderToSpotlight(ORDER)).resolves.toMatchObject({
        delivered: false,
      });
    }
  });
});
