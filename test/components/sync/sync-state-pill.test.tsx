/**
 * SyncStatePill — truthfulness pins (fix(sync), operator-caught in the
 * pass-B offline run: the pill claimed "Synced" while the completion
 * entry was still queued).
 *
 * The rule: state derives from the pending outbox count, not from
 * run completion. lastSyncAt is only trusted at zero pending.
 *
 *   - pending + effective-offline → "Waiting to sync · N"
 *   - pending + online            → "Syncing…"
 *   - zero pending + lastSyncAt   → "Synced"
 *
 * Effective-offline is produced the way the engine produces it:
 * syncFailed(…, "other") flips serverReachable false (navigator.onLine
 * stays true in jsdom, like macOS with Wi-Fi off — the exact shape the
 * operator hit). The status singleton is per-test-file in vitest, and
 * every test sets the fields it reads, so ordering is immaterial.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { SyncStatePill } from "@/components/sync/sync-state-pill";
import { syncFinished, syncFailed } from "@/lib/sync/status";
import { enqueueAction } from "@/lib/db/outbox";
import { db } from "@/lib/db";

async function seedPendingEntry() {
  await enqueueAction({
    action_name: "completeServiceSheetAction",
    args: { job_id: "pill-job" },
    entity_type: "job",
    entity_id: "pill-job",
  });
}

beforeEach(async () => {
  await db.outbox.clear();
});

describe("SyncStatePill — never claims Synced with pending entries", () => {
  it("pending + offline → 'Waiting to sync · 1'", async () => {
    await seedPendingEntry();
    syncFailed("Server unreachable", "other"); // effective-offline

    render(<SyncStatePill />);

    await waitFor(() => {
      expect(screen.getByText("Waiting to sync · 1")).toBeInTheDocument();
    });
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
  });

  it("pending + online → 'Syncing…' (even between engine runs)", async () => {
    await seedPendingEntry();
    syncFinished(); // serverReachable true + fresh lastSyncAt — the lie's old fuel

    render(<SyncStatePill />);

    await waitFor(() => {
      expect(screen.getByText("Syncing…")).toBeInTheDocument();
    });
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
  });

  it("zero pending + lastSyncAt → 'Synced'", async () => {
    syncFinished();

    render(<SyncStatePill />);

    await waitFor(() => {
      expect(screen.getByText("Synced")).toBeInTheDocument();
    });
  });
});
