/**
 * "Request review" dashboard widget gated by REVIEW_REQUESTS_ENABLED.
 *
 * One feature, one switch: the same flag that disables review-task
 * auto-creation also unregisters the dashboard widget. The registry is
 * the registration gate (it drives both the Add-widget picker and which
 * ids DashboardGrid treats as valid — an unregistered id is dropped from
 * any saved layout cleanly). We assert membership in both flag states by
 * re-importing the module with the flag mocked.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

async function registryIds(enabled: boolean): Promise<string[]> {
  vi.resetModules();
  vi.doMock("@/lib/constants/feature-flags", () => ({
    REVIEW_REQUESTS_ENABLED: enabled,
  }));
  const mod = await import(
    "@/components/dashboard/dashboard-customisation-bar"
  );
  return mod.WIDGET_REGISTRY.map((w) => w.id);
}

afterEach(() => {
  vi.doUnmock("@/lib/constants/feature-flags");
  vi.resetModules();
});

describe("Request review widget — REVIEW_REQUESTS_ENABLED gate", () => {
  it("flag ON → 'review-requests' is registered", async () => {
    const ids = await registryIds(true);
    expect(ids).toContain("review-requests");
  });

  it("flag OFF → 'review-requests' is NOT registered (drops from saved layouts)", async () => {
    const ids = await registryIds(false);
    expect(ids).not.toContain("review-requests");
    // The rest of the registry is unaffected — only this id is gated.
    expect(ids).toContain("service-sheets-to-fill");
    expect(ids).toContain("drafts-to-upgrade");
  });
});
