/**
 * (app) error boundary — graceful offline degradation.
 *
 * The boundary renders one of two screens:
 *
 *   - "You're offline" when useIsOnline() === false (primary signal)
 *     OR when the error's message looks network-shaped (secondary).
 *   - "Something went wrong" otherwise.
 *
 * The primary-vs-secondary distinction matters because Next.js
 * sanitises server-component error messages in production builds, so
 * the message check can't be relied on — useIsOnline() is what
 * actually works in both dev AND production.
 *
 * These tests pin the branching contract.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import AppError from "@/app/(app)/error";

beforeEach(() => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

function setOffline() {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  window.dispatchEvent(new Event("offline"));
}

describe("AppError — offline screen", () => {
  it("shows 'You're offline' when navigator.onLine is false (primary signal)", () => {
    setOffline();
    // Any error shape — the offline check is on the live online
    // state, not the error message.
    render(
      <AppError error={new Error("Something opaque")} reset={() => {}} />
    );
    expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
    expect(
      screen.getByText(/job and customer lists still work offline/i)
    ).toBeInTheDocument();
  });

  it("shows 'You're offline' when message is network-shaped even if online (secondary signal)", () => {
    // navigator.onLine === true (default) — but the error is fetch-shaped.
    // Useful for the rare in-dev "single-endpoint network failure" case.
    render(
      <AppError
        error={new TypeError("fetch failed")}
        reset={() => {}}
      />
    );
    expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
  });
});

describe("AppError — generic error screen", () => {
  it("shows 'Something went wrong' for a non-network error when online", () => {
    render(
      <AppError
        error={new Error("Database constraint violation")}
        reset={() => {}}
      />
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/You're offline/i)).toBeNull();
  });
});

describe("AppError — Try again button", () => {
  it("calls reset() when clicked", () => {
    const reset = (() => {
      let called = false;
      const fn = () => {
        called = true;
      };
      (fn as unknown as { called: () => boolean }).called = () => called;
      return fn as unknown as (() => void) & { called: () => boolean };
    })();
    render(<AppError error={new Error("any")} reset={reset} />);
    const button = screen.getByRole("button", { name: /try again/i });
    button.click();
    expect(reset.called()).toBe(true);
  });
});
