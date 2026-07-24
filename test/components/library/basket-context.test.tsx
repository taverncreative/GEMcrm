/**
 * The print basket persists across navigation/reload: it is localStorage
 * backed, so adding an item, tearing the provider down (a fresh page), and
 * mounting a new provider restores the basket.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BasketProvider, useBasket } from "@/components/library/basket-context";

function Harness() {
  const basket = useBasket();
  return (
    <div>
      <span data-testid="count">{basket.totalItems}</span>
      <span data-testid="qty">{basket.quantityOf("doc-1")}</span>
      <button onClick={() => basket.add("doc-1", "Site Rules", 2)}>add</button>
    </div>
  );
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("basket persistence", () => {
  it("survives a provider remount (new page load)", async () => {
    const first = render(
      <BasketProvider>
        <Harness />
      </BasketProvider>
    );
    // Add after hydration.
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));

    // It reached localStorage.
    expect(window.localStorage.getItem("gemcrm-print-basket")).toContain("doc-1");

    // Tear down and mount a completely fresh provider — the basket returns.
    first.unmount();
    render(
      <BasketProvider>
        <Harness />
      </BasketProvider>
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    expect(screen.getByTestId("qty").textContent).toBe("2");
  });

  it("adding the same document again accumulates quantity", async () => {
    render(
      <BasketProvider>
        <Harness />
      </BasketProvider>
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    fireEvent.click(screen.getByText("add"));
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("qty").textContent).toBe("4"));
    // Still one line, quantity accumulated.
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});
