/**
 * runSync — a pass that never reaches the server must not report
 * success (fix(sync), operator-caught in the pass-B offline run).
 *
 * Offline-under-the-service-worker shape: navigator.onLine lies
 * `true`, every pull server-action fetch rejects. Before the fix the
 * engine only failed the run when pullAll THREW or halted (auth) —
 * per-entity network errors fell through to syncFinished(), stamping a
 * fresh lastSyncAt and flipping serverReachable back to true on a
 * fully dead pass. Every consumer of effective-online (the sync pills,
 * write guards) then lied.
 *
 * Pins:
 *   (a) ALL pulls network-fail → syncFailed: serverReachable false,
 *       lastSyncAt NOT stamped;
 *   (b) one entity succeeding means the server WAS reachable →
 *       syncFinished as before;
 *   (c) all pulls succeeding → syncFinished (unchanged happy path).
 *
 * The registry and photo loop are stubbed only because their import
 * graphs drag in server-only modules; the outbox is empty in these
 * tests so neither is exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const pullMocks = vi.hoisted(() => ({
  pullCustomersAction: vi.fn(),
  pullSitesAction: vi.fn(),
  pullJobsAction: vi.fn(),
  pullAgreementsAction: vi.fn(),
  pullTasksAction: vi.fn(),
  pullBlockedPeriodsAction: vi.fn(),
}));
vi.mock("@/app/(app)/sync/pull-actions", () => pullMocks);
vi.mock("@/lib/sync/registry", () => ({
  invokeFromRegistry: vi.fn(),
  UnknownActionError: class UnknownActionError extends Error {},
}));
vi.mock("@/lib/sync/photos", () => ({
  drainPhotos: vi.fn(async () => ({ attempted: 0, uploaded: 0, failed: 0 })),
}));

import { runSync } from "@/lib/sync/engine";
import { getSyncStatus } from "@/lib/sync/status";
import { db } from "@/lib/db";

const networkReject = () =>
  Promise.reject(new TypeError("fetch failed"));

beforeEach(async () => {
  await db.outbox.clear();
  vi.clearAllMocks();
});

describe("runSync — network-dead pass", () => {
  it("(a) every pull network-fails → syncFailed, no lastSyncAt stamp, serverReachable false", async () => {
    for (const fn of Object.values(pullMocks)) {
      fn.mockImplementation(networkReject);
    }
    const before = getSyncStatus().lastSyncAt;

    const result = await runSync("manual");

    expect(result.ran).toBe(true);
    const status = getSyncStatus();
    expect(status.syncing).toBe(false);
    expect(status.serverReachable).toBe(false);
    expect(status.lastSyncAt).toBe(before); // NOT stamped by a dead pass
    expect(status.lastError).toBe("Server unreachable");
  });

  it("(b) one entity reaching the server → pass still counts as finished", async () => {
    for (const fn of Object.values(pullMocks)) {
      fn.mockImplementation(networkReject);
    }
    pullMocks.pullCustomersAction.mockImplementation(async () => []);

    await runSync("manual");

    const status = getSyncStatus();
    expect(status.serverReachable).toBe(true);
    expect(status.lastSyncAt).not.toBeNull();
  });

  it("(c) all pulls succeed → finished (unchanged happy path)", async () => {
    for (const fn of Object.values(pullMocks)) {
      fn.mockImplementation(async () => []);
    }

    await runSync("manual");

    const status = getSyncStatus();
    expect(status.serverReachable).toBe(true);
    expect(status.lastSyncAt).not.toBeNull();
    expect(status.lastError).toBeNull();
  });
});
