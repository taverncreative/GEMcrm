/**
 * The Draft / Sent badge. "Sent" is written only by a real email send, so the
 * badge must never claim delivery for anything else — including a legacy or
 * unexpected status value, which reads as Draft.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";

describe("QuoteStatusBadge", () => {
  it("renders Sent for a sent quote", () => {
    render(<QuoteStatusBadge status="sent" />);
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("renders Draft for a draft quote", () => {
    render(<QuoteStatusBadge status="draft" />);
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByText("Sent")).toBeNull();
  });

  it("renders Draft for null or an unknown value — never a false 'Sent'", () => {
    const { rerender } = render(<QuoteStatusBadge status={null} />);
    expect(screen.getByText("Draft")).toBeTruthy();
    rerender(<QuoteStatusBadge status="something-else" />);
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByText("Sent")).toBeNull();
  });
});
