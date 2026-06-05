/**
 * SmartBackButton — context-aware in-app back arrow.
 *
 * The contract: when there's real in-app history (window.history.length
 * > 1) the arrow returns to the ACTUAL previous screen via router.back();
 * on a cold/direct load (length <= 1) it falls back to the canonical
 * parent via router.push(fallbackHref). This is what fixes
 * "dashboard → sheet → ‹ → dashboard" while leaving
 * "job → sheet → ‹ → job" untouched.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const back = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push }),
}));

import { SmartBackButton } from "@/components/smart-back-button";

function setHistoryLength(n: number) {
  Object.defineProperty(window.history, "length", {
    configurable: true,
    value: n,
  });
}

describe("SmartBackButton", () => {
  beforeEach(() => {
    back.mockClear();
    push.mockClear();
  });

  it("returns to the actual previous screen (router.back) when there is in-app history", async () => {
    setHistoryLength(3);
    const user = userEvent.setup();
    render(<SmartBackButton fallbackHref="/jobs/abc" />);
    await user.click(screen.getByRole("button", { name: /Back/i }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to the canonical parent (router.push) on a cold load with no history", async () => {
    setHistoryLength(1);
    const user = userEvent.setup();
    render(<SmartBackButton fallbackHref="/jobs/abc" />);
    await user.click(screen.getByRole("button", { name: /Back/i }));
    expect(push).toHaveBeenCalledWith("/jobs/abc");
    expect(back).not.toHaveBeenCalled();
  });

  it("uses a custom accessible label when provided", () => {
    setHistoryLength(2);
    render(<SmartBackButton fallbackHref="/jobs/abc" label="Back to job" />);
    expect(
      screen.getByRole("button", { name: "Back to job" })
    ).toBeInTheDocument();
  });
});
