/**
 * BottomNav — mobile tab bar (nav-only UI refresh).
 *
 * Covers: the four tabs + center "+ New" render; active-state mirrors
 * the sidebar predicate (exact + nested route); "More" opens the
 * overflow sheet; "+ New" opens the create menu. Modals are stubbed —
 * we're testing nav, not their internals.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

let pathnameMock = "/jobs";
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
}));

vi.mock("@/components/bookings/booking-modal", () => ({
  BookingModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="booking-modal" /> : null,
}));
vi.mock("@/components/invoices/invoice-creator-modal", () => ({
  InvoiceCreatorModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="invoice-modal" /> : null,
}));

import { BottomNav } from "@/components/bottom-nav";

function setPath(p: string) {
  pathnameMock = p;
}

describe("BottomNav — tabs", () => {
  it("renders the four tabs and the center + New", () => {
    setPath("/jobs");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /Jobs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Customers/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Calendar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^More$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create new/i })
    ).toBeInTheDocument();
  });

  it("links point at the real routes", () => {
    setPath("/jobs");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /Jobs/i })).toHaveAttribute(
      "href",
      "/jobs"
    );
    expect(screen.getByRole("link", { name: /Customers/i })).toHaveAttribute(
      "href",
      "/customers"
    );
    expect(screen.getByRole("link", { name: /Calendar/i })).toHaveAttribute(
      "href",
      "/calendar"
    );
  });
});

describe("BottomNav — active state (sidebar predicate)", () => {
  it("marks the exact-match tab active", () => {
    setPath("/customers");
    render(<BottomNav />);
    expect(
      screen.getByRole("link", { name: /Customers/i })
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Jobs/i })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("marks a tab active on a nested route (/jobs/123 → Jobs)", () => {
    setPath("/jobs/abc-123");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /Jobs/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("marks More active when on a More destination (/settings)", () => {
    setPath("/settings");
    render(<BottomNav />);
    expect(
      screen.getByRole("button", { name: /^More$/i })
    ).toHaveAttribute("aria-current", "page");
  });
});

describe("BottomNav — sheets", () => {
  it("More opens the overflow sheet with Dashboard / Documentation / Settings", async () => {
    setPath("/jobs");
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByRole("button", { name: /^More$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Dashboard/i })
      ).toHaveAttribute("href", "/dashboard");
    });
    expect(
      screen.getByRole("link", { name: /Documentation/i })
    ).toHaveAttribute("href", "/reports");
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute(
      "href",
      "/settings"
    );
  });

  it("+ New opens the create menu (Booking / Invoice / Add Customer)", async () => {
    setPath("/jobs");
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByRole("button", { name: /Create new/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /New Booking/i })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /New Invoice/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Add Customer/i })
    ).toHaveAttribute("href", "/customers/new");
  });

  it("choosing New Booking from the create menu opens the booking modal", async () => {
    setPath("/jobs");
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByRole("button", { name: /Create new/i }));
    await user.click(
      await screen.findByRole("button", { name: /New Booking/i })
    );
    await waitFor(() => {
      expect(screen.getByTestId("booking-modal")).toBeInTheDocument();
    });
  });
});
