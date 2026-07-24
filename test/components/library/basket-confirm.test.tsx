/**
 * BasketBar confirm — the client mapping and clear-on-success behaviour:
 *   - each basket line maps to { reference = documentId, name = label,
 *     quantity } (the "reference = document id" contract, so a later rename
 *     can't break the order);
 *   - a single client-generated uuid order id is sent (idempotency key);
 *   - on success the basket clears.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const submitMock = vi.fn(async () => ({ success: true, message: "Order sent to print." }));
vi.mock("@/app/(app)/library/actions", () => ({
  submitPrintOrderAction: (...a: unknown[]) =>
    (submitMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock("@/lib/hooks/use-is-online", () => ({ useIsOnline: () => true }));

import { BasketProvider } from "@/components/library/basket-context";
import { BasketBar } from "@/components/library/basket-bar";

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  submitMock.mockClear();
  // Seed a basket so BasketBar renders on hydration.
  window.localStorage.setItem(
    "gemcrm-print-basket",
    JSON.stringify([
      { documentId: "doc-a", label: "Site Rules", quantity: 3 },
      { documentId: "doc-b", label: "Method Statement", quantity: 1 },
    ])
  );
});

function renderBar() {
  return render(
    <BasketProvider>
      <BasketBar />
    </BasketProvider>
  );
}

describe("confirm maps basket → order payload", () => {
  it("sends reference=documentId, name=label, quantity, and a uuid orderId", async () => {
    renderBar();
    // The floating basket button appears once hydrated.
    const basketBtn = await screen.findByRole("button", { name: /Print basket/i });
    fireEvent.click(basketBtn);
    const confirm = await screen.findByRole("button", { name: /Confirm order/i });
    fireEvent.click(confirm);

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const arg = (submitMock.mock.calls[0] as unknown as unknown[])[0] as {
      orderId: string;
      items: { reference: string; name: string; quantity: number }[];
    };
    expect(arg.items).toEqual([
      { reference: "doc-a", name: "Site Rules", quantity: 3 },
      { reference: "doc-b", name: "Method Statement", quantity: 1 },
    ]);
    // A real client-generated uuid.
    expect(arg.orderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("clears the basket on success (the floating button disappears)", async () => {
    renderBar();
    const basketBtn = await screen.findByRole("button", { name: /Print basket/i });
    fireEvent.click(basketBtn);
    fireEvent.click(await screen.findByRole("button", { name: /Confirm order/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Print basket/i })).toBeNull()
    );
  });
});
