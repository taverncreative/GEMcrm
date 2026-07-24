/**
 * submitPrintOrderAction — the print-basket confirm. Same fire-and-forget
 * fence as the feedback submit, plus the Spotlight print-order contract.
 *
 * Pins:
 *   - the confirmation returns success WITHOUT waiting for the POST (the row
 *     is the record; a Spotlight outage never fails the confirm);
 *   - the order id is threaded through UNCHANGED as both the print_orders id
 *     and Spotlight's order_id (idempotency: a retry with the same id can't
 *     duplicate);
 *   - the payload maps each item to { name, quantity, reference } and sends
 *     submitter + ordered_at, with NO source field;
 *   - Spotlight's limits (1–100 items, name ≤300, qty 1–10000) gate before
 *     anything is written;
 *   - the delivery outcome is recorded after the POST.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createPrintOrderMock = vi.fn(async (input: Record<string, unknown>) => ({
  id: input.id,
  ...input,
}));
const markDeliveredMock = vi.fn(async () => {});
vi.mock("@/lib/data/print-orders", () => ({
  createPrintOrder: (...a: unknown[]) =>
    (createPrintOrderMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  markPrintOrderDelivered: (...a: unknown[]) =>
    (markDeliveredMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown | Promise<unknown>) => {
    afterCallbacks.push(cb);
  },
}));
async function runAfter(): Promise<void> {
  const cbs = afterCallbacks.splice(0);
  for (const cb of cbs) await cb();
}

import { submitPrintOrderAction } from "@/app/(app)/library/actions";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ITEMS = [
  { reference: "doc-a", name: "Site Rules", quantity: 3 },
  { reference: "doc-b", name: "Method Statement", quantity: 1 },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SPOTLIGHT_PRINT_ORDER_URL = "https://spotlight.test/api/inbound/print-order";
  process.env.SPOTLIGHT_INGEST_TOKEN = "tok_abc";
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  createPrintOrderMock.mockClear();
  markDeliveredMock.mockClear();
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("instant confirm — the POST is deferred", () => {
  it("returns success before the POST fires, even if Spotlight hangs", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const res = await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    expect(res.success).toBe(true);
    expect(res.message).toBe("Order sent to print.");
    // Row written synchronously; POST only scheduled.
    expect(createPrintOrderMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });
});

describe("idempotency — the order id is threaded through unchanged", () => {
  it("uses orderId as the row id AND Spotlight's order_id", async () => {
    await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    expect((createPrintOrderMock.mock.calls[0][0] as { id: string }).id).toBe(ORDER_ID);
    await runAfter();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.order_id).toBe(ORDER_ID);
  });
});

describe("payload maps to Spotlight's contract", () => {
  it("posts items {name, quantity, reference} + submitter + ordered_at, no source", async () => {
    await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    await runAfter();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://spotlight.test/api/inbound/print-order");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_abc");
    const body = JSON.parse(init.body as string);
    expect(body.items).toEqual([
      { name: "Site Rules", quantity: 3, reference: "doc-a" },
      { name: "Method Statement", quantity: 1, reference: "doc-b" },
    ]);
    expect(body.submitter).toBe("Nate Green");
    expect(typeof body.ordered_at).toBe("string");
    expect("source" in body).toBe(false);
    expect("source_app" in body).toBe(false);
  });
});

describe("THE FENCE — Spotlight can never fail the confirm", () => {
  it("still succeeds when the POST rejects, and records the failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    expect(res.success).toBe(true);
    await expect(runAfter()).resolves.toBeUndefined();
    // Outcome recorded as not delivered, with a reason.
    const [id, delivered, reason] = markDeliveredMock.mock.calls[0] as unknown as [
      string,
      boolean,
      string
    ];
    expect(id).toBe(ORDER_ID);
    expect(delivered).toBe(false);
    expect(reason).toBeTruthy();
  });

  it("still succeeds when Spotlight 500s", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    expect(res.success).toBe(true);
    await runAfter();
    expect((markDeliveredMock.mock.calls[0] as unknown[])[1]).toBe(false);
  });

  it("records delivered=true on a 200", async () => {
    await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    await runAfter();
    expect((markDeliveredMock.mock.calls[0] as unknown[])[1]).toBe(true);
  });
});

describe("limits gate before anything is written", () => {
  it("rejects more than 100 items", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      reference: `doc-${i}`,
      name: `Doc ${i}`,
      quantity: 1,
    }));
    const res = await submitPrintOrderAction({ orderId: ORDER_ID, items: many });
    expect(res.success).toBe(false);
    expect(createPrintOrderMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("rejects quantity 0 and quantity over 10000", async () => {
    const zero = await submitPrintOrderAction({
      orderId: ORDER_ID,
      items: [{ reference: "d", name: "D", quantity: 0 }],
    });
    expect(zero.success).toBe(false);
    const huge = await submitPrintOrderAction({
      orderId: ORDER_ID,
      items: [{ reference: "d", name: "D", quantity: 10001 }],
    });
    expect(huge.success).toBe(false);
    expect(createPrintOrderMock).not.toHaveBeenCalled();
  });

  it("rejects an empty basket and a non-uuid order id", async () => {
    expect(
      (await submitPrintOrderAction({ orderId: ORDER_ID, items: [] })).success
    ).toBe(false);
    expect(
      (await submitPrintOrderAction({ orderId: "not-a-uuid", items: ITEMS })).success
    ).toBe(false);
  });
});

describe("skipped when unconfigured — confirm still works", () => {
  it("no POST when the URL is unset", async () => {
    delete process.env.SPOTLIGHT_PRINT_ORDER_URL;
    const res = await submitPrintOrderAction({ orderId: ORDER_ID, items: ITEMS });
    expect(res.success).toBe(true);
    await runAfter();
    expect(fetchMock).not.toHaveBeenCalled();
    // Still recorded (as not delivered / not configured).
    expect((markDeliveredMock.mock.calls[0] as unknown[])[1]).toBe(false);
  });
});
