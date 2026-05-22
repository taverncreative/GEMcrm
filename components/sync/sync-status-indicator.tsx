"use client";

/**
 * Header chip showing the current sync state at a glance.
 *
 * Five visual states, in priority order (first match wins):
 *
 *   1. authExpired  → amber dot, "Session expired"      (panel: re-login link)
 *   2. !online      → grey dot,  "Offline · N pending"  (panel: pending list)
 *   3. stuck > 0    → red dot,   "N stuck — tap"        (panel: conflicts link)
 *   4. syncing      → blue spin, "Syncing…"             (panel: in-flight info)
 *   5. pending > 0  → yellow,    "N pending"            (panel: pending list)
 *   6. else         → green dot, "Synced X min ago"     (panel: idle info)
 *
 * Tap the chip → bottom-anchored popover with details. Popover dismisses
 * on outside click, Escape, or after a Sync-now action completes.
 *
 * Counts come from useLiveQuery so they're always fresh — no manual
 * invalidation. The panel's "Sync now" button calls runSync('manual')
 * which the engine guards against overlap.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSyncStatus } from "@/lib/sync/status";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { runSync } from "@/lib/sync/engine";

type Visual = {
  kind: "auth" | "offline" | "stuck" | "syncing" | "pending" | "synced" | "never";
  dotClass: string;
  label: string;
};

function relative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function SyncStatusIndicator() {
  const status = useSyncStatus();
  const online = useIsOnline();
  const pendingCount = useLiveQuery(
    () => db.outbox.filter((e) => !e.stuck).count(),
    [],
    0
  );
  const stuckCount = useLiveQuery(
    () => db.outbox.filter((e) => e.stuck).count(),
    [],
    0
  );
  const photosPending = useLiveQuery(
    () => db.photos_pending.filter((p) => !p.uploaded).count(),
    [],
    0
  );
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Recompute "Synced X minutes ago" once a minute while idle so the
  // label stays fresh without burning a setInterval most of the time.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (status.syncing || !status.lastSyncAt) return;
    const i = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(i);
  }, [status.syncing, status.lastSyncAt]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visual: Visual = (() => {
    if (status.authExpired) {
      return { kind: "auth", dotClass: "bg-amber-400", label: "Session expired" };
    }
    if (!online) {
      return {
        kind: "offline",
        dotClass: "bg-gray-400",
        label:
          pendingCount > 0
            ? `Offline · ${pendingCount} pending`
            : "Offline",
      };
    }
    if (stuckCount > 0) {
      return {
        kind: "stuck",
        dotClass: "bg-red-500",
        label: `${stuckCount} stuck — tap`,
      };
    }
    if (status.syncing) {
      return { kind: "syncing", dotClass: "bg-blue-400 animate-pulse", label: "Syncing…" };
    }
    if (pendingCount > 0) {
      return {
        kind: "pending",
        dotClass: "bg-yellow-400",
        label: `${pendingCount} pending`,
      };
    }
    if (status.lastSyncAt) {
      return {
        kind: "synced",
        dotClass: "bg-green-500",
        label: `Synced ${relative(status.lastSyncAt)}`,
      };
    }
    return { kind: "never", dotClass: "bg-gray-300", label: "Not yet synced" };
  })();

  async function handleSyncNow() {
    setOpen(false);
    await runSync("manual");
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Sync status"
        title={visual.label}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-gray-300 transition-colors hover:bg-ink-soft"
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${visual.dotClass}`}
        />
        <span className="hidden sm:inline">{visual.label}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Sync details"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-xl"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Sync</h3>
            <span className="text-xs text-gray-400">{visual.label}</span>
          </div>

          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-gray-500">Last successful</dt>
              <dd>{relative(status.lastSyncAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Pending (outbox)</dt>
              <dd className="font-mono">{pendingCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Stuck</dt>
              <dd className="font-mono">{stuckCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Photos uploading</dt>
              <dd className="font-mono">{photosPending}</dd>
            </div>
            {status.lastReason && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Last trigger</dt>
                <dd>{status.lastReason}</dd>
              </div>
            )}
            {status.lastError && (
              <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                {status.lastError}
              </div>
            )}
          </dl>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={!online || status.syncing}
              className="flex-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {status.syncing ? "Syncing…" : "Sync now"}
            </button>
            {stuckCount > 0 && (
              <Link
                href="/sync/conflicts"
                onClick={() => setOpen(false)}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Conflicts ({stuckCount})
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
