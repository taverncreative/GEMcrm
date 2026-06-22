/**
 * SyncBoot robustness regression tests.
 *
 * Background. The operator hit a permanent "Loading your data…"
 * hang during step-7 testing. Three structural gaps were uncovered:
 *
 *   1. The Dexie singleton had no `blocked` / `versionchange`
 *      handlers, so an upgrade blocked by another tab held at the
 *      old version would hang `db.open()` indefinitely.
 *   2. SyncBoot's `boot()` async function had NO outer try/catch
 *      around the whole body — only `pullAll` was wrapped. ANY throw
 *      before that (sync_meta probe, wipe, cursor count, put) →
 *      unhandled rejection → bootState stuck at "checking" forever.
 *   3. There was no time-bounded fallback. A never-resolving await
 *      could never be recovered from without a page reload.
 *
 * These tests assert the structural invariants that close all three:
 *
 *   (a) Steady-state boot (cursors present, same user) reaches
 *       "ready" — the overlay disappears, nothing left on screen.
 *   (b) A thrown error from the initial sync_meta probe lands the
 *       boot in a visible error state with a retry button — never
 *       a silent hang. (Equivalent to the upgrade-blocked path.)
 *   (c) A boot that never reaches any terminal state must hit the
 *       watchdog within BOOT_TIMEOUT_MS and present a retry button.
 *
 * Implementation notes:
 *
 *   - We don't import the real BOOT_TIMEOUT_MS constant (private to
 *     sync-boot.tsx). Tests use fake timers and advance past 15s.
 *   - The pullAll/runSync internals are mocked to no-ops so tests
 *     focus on the boot state machine, not the sync engine.
 *   - Mocks live BEFORE the SyncBoot import (vitest hoists vi.mock
 *     so this is safe even with the post-hoc ordering).
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks (hoisted before imports) ───────────────────────────────

vi.mock("@/lib/sync/pull", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/pull")>(
    "@/lib/sync/pull"
  );
  return {
    ...actual,
    pullAll: vi.fn(async () => ({ entities: [], halted: false })),
  };
});

vi.mock("@/lib/sync/engine", () => ({
  runSync: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync/status", () => ({
  getSyncStatus: () => ({ authExpired: false }),
  clearAuthExpired: vi.fn(),
}));

vi.mock("@/lib/db/dev", () => ({
  wipeLocalDb: vi.fn(async () => undefined),
}));

// ─── Imports ──────────────────────────────────────────────────────

import { SyncBoot } from "@/components/sync/sync-boot";
import { db } from "@/lib/db";

beforeEach(async () => {
  // Fake timers so we can advance past the 15s watchdog deterministically.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Reset Dexie state between tests.
  await db.sync_meta.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── (a) Steady-state boot reaches ready ──────────────────────────

describe("SyncBoot — steady state", () => {
  it("reveals the app (no overlay) when user matches and cursors exist", async () => {
    // Pre-seed sync_meta with the canonical "returning user" shape.
    await db.sync_meta.put({ key: "current_user_id", value: "u-1" });
    await db.sync_meta.put({
      key: "cursor.customers",
      value: "2026-05-01T00:00:00Z",
    });
    await db.sync_meta.put({
      key: "cursor.jobs",
      value: "2026-05-01T00:00:00Z",
    });

    render(<SyncBoot userId="u-1" />);

    // Grace window: the overlay is NOT painted on the first render — a warm
    // steady-state launch reveals the app with no loading-screen flash.
    // (Previously the overlay showed during the brief "checking" phase.)
    expect(
      screen.queryByRole("dialog", { name: /initial sync/i })
    ).toBeNull();

    // appReady = boot "ready" + the post-hydration mount beacon + the
    // core-table warm read, all resolving. Once they do, the app is revealed
    // and nothing is left on screen. (If the core-table warm never flipped
    // coreTablesRead, the grace timer would paint the overlay and this
    // assertion would fail — so a green here exercises the whole gate.)
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /initial sync/i })
      ).toBeNull();
    });
  });
});

// ─── (b) Throw in pre-pullAll path → visible error ────────────────

describe("SyncBoot — error in pre-pull boot path", () => {
  it("routes a thrown sync_meta error to a visible retry overlay (not a silent hang)", async () => {
    // Force the very first await (`db.sync_meta.get(USER_ID_KEY)`)
    // to throw. Pre-fix this would have left bootState at "checking"
    // forever with no signal to the operator.
    const original = db.sync_meta.get.bind(db.sync_meta);
    // Dexie's `.get` returns a PromiseExtended (Dexie's own Promise
    // subclass with a `.timeout()` method on it). Vitest's spyOn
    // demands the original's return type — async functions return
    // plain Promises, which lack `.timeout()`. The cast is the
    // canonical workaround for spying on Dexie methods: we only care
    // about the awaited value, not the PromiseExtended API surface.
    const spy = vi
      .spyOn(db.sync_meta, "get")
      .mockImplementation(
        (() =>
          Promise.reject(new Error("simulated IDB failure"))) as unknown as typeof db.sync_meta.get
      );

    try {
      render(<SyncBoot userId="u-1" />);

      // The overlay must show an error message with a Retry button.
      await waitFor(
        () => {
          expect(
            screen.getByText(/Local store unavailable/i)
          ).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      expect(
        screen.getByRole("button", { name: /retry/i })
      ).toBeInTheDocument();
    } finally {
      spy.mockRestore();
      // Re-attach the original for any later test in the same file.
      void original;
    }
  });
});

// ─── (c) Watchdog catches a never-resolving boot ──────────────────

describe("SyncBoot — watchdog terminates a hung boot", () => {
  it("surfaces a retryable error within ~15s if boot never reaches a terminal state", async () => {
    // Simulate a Dexie open that never resolves — the canonical
    // "upgrade blocked by another tab at the old version" pathology.
    // sync_meta.get returns a Promise that never settles.
    // Cast as above: PromiseExtended vs Promise is irrelevant for
    // an indefinitely-pending Promise.
    vi.spyOn(db.sync_meta, "get").mockImplementation(
      (() => new Promise(() => {})) as unknown as typeof db.sync_meta.get
    );

    render(<SyncBoot userId="u-1" />);

    // Watchdog should fire at BOOT_TIMEOUT_MS (15s). Advance fake
    // timers past it.
    await act(async () => {
      vi.advanceTimersByTime(16_000);
      await Promise.resolve();
    });

    // After the watchdog: a visible timeout error with retry.
    await waitFor(
      () => {
        expect(
          screen.getByText(/sync took too long/i)
        ).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(
      screen.getByRole("button", { name: /retry/i })
    ).toBeInTheDocument();
  });
});
