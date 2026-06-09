/**
 * Retired full-page customer profile (app/(app)/customers/[id]/page.tsx).
 *
 * Contract: the route no longer renders a profile. It is a CLIENT redirect
 * to the offline-capable side panel on the /customers list — `router.replace`
 * to `/customers?customer=<id>` (which `customers-table` reads to auto-open
 * the panel). A client redirect (not a server `redirect()`) is deliberate:
 * the service worker can't follow a 3xx navigation response, so a server
 * redirect would land the user on the offline shell; a plain 200 client page
 * is served fine and redirects on hydrate.
 *
 * These tests pin the redirect target so the route can't silently regress
 * back to a stranded full page — the browser e2e is the operator's preview,
 * but the redirect logic itself is verified here, environment-independently.
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const replace = vi.fn();
let mockParams: Record<string, string | string[]> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useParams: () => mockParams,
}));

import CustomerDetailRedirect from "@/app/(app)/customers/[id]/page";
import { ROUTES } from "@/lib/constants/routes";

describe("Retired /customers/[id] → side-panel redirect", () => {
  beforeEach(() => {
    replace.mockClear();
    mockParams = {};
  });

  it("replaces to /customers?customer=<id> for a valid id", () => {
    mockParams = { id: "aaaaaaaa-0000-4000-8000-000000000001" };
    render(<CustomerDetailRedirect />);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(
      `${ROUTES.CUSTOMERS}?customer=aaaaaaaa-0000-4000-8000-000000000001`
    );
  });

  it("url-encodes the id", () => {
    mockParams = { id: "a b/c?d" };
    render(<CustomerDetailRedirect />);
    expect(replace).toHaveBeenCalledWith(
      `${ROUTES.CUSTOMERS}?customer=${encodeURIComponent("a b/c?d")}`
    );
  });

  it("falls back to the bare customers list when the id is missing", () => {
    mockParams = {};
    render(<CustomerDetailRedirect />);
    expect(replace).toHaveBeenCalledWith(ROUTES.CUSTOMERS);
  });

  it("renders no profile content (it is a pure redirect)", () => {
    mockParams = { id: "x" };
    const { container } = render(<CustomerDetailRedirect />);
    expect(container).toBeEmptyDOMElement();
  });
});
