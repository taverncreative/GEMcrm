"use client";

/**
 * Active nudge for NEWLY-stuck outbox entries (H3).
 *
 * A queued replay that permanently fails is marked `stuck` and drops out
 * of the drain — the local row still looks saved, and the only signal
 * was the passive red dot in the topbar. An operator could lose a
 * booking / service sheet without knowing.
 *
 * This surfaces two active signals the moment an entry NEWLY sticks:
 *   - a transient TOAST (auto-dismiss), and
 *   - a persistent BANNER that survives client navigation until the
 *     operator dismisses it.
 * Both name the record in operator terms and link to /sync/conflicts
 * (the existing retry/discard surface) — no new management UI invented.
 *
 * No repeat nagging: ids already surfaced are persisted in localStorage,
 * so an already-stuck entry does NOT re-fire on reload/boot. The ambient
 * red dot remains as the standing signal after acknowledgement.
 *
 * Offline-safe: reads only Dexie + localStorage; never touches the
 * network. Mounted globally in the app shell.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { describeStuckEntry } from "@/lib/sync/describe-stuck";

const CONFLICTS_ROUTE = "/sync/conflicts";
const NOTIFIED_KEY = "gemcrm-stuck-notified";
const TOAST_MS = 8000;

interface StuckItem {
  id: number;
  label: string;
}

function loadNotified(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => typeof n === "number")
      : [];
  } catch {
    return [];
  }
}

function saveNotified(ids: number[]): void {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(ids));
  } catch {
    /* storage full / disabled — the ambient red dot still stands */
  }
}

export function StuckSyncAlert() {
  const stuck = useLiveQuery(async () => {
    const rows = await db.outbox.filter((e) => e.stuck).sortBy("created_at");
    return rows.map<StuckItem>((e) => ({
      id: e.id!,
      label: describeStuckEntry(e),
    }));
  });

  // Ids already actively surfaced (persisted). Loaded once on mount — the
  // durable set the first stuck-diff compares against, which is what stops
  // an already-stuck entry re-firing on reload.
  const notifiedRef = useRef<Set<number>>(new Set());
  const [notifiedLoaded, setNotifiedLoaded] = useState(false);
  useEffect(() => {
    notifiedRef.current = new Set(loadNotified());
    // One-time mount load of the persisted notified set; a deliberate
    // synchronous flag flip, not the cascading-render pattern the rule targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifiedLoaded(true);
  }, []);

  // In-session surface. React state → persists across client navigation
  // (the shell stays mounted) and resets on a full reload.
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<StuckItem[]>([]);

  useEffect(() => {
    if (!stuck || !notifiedLoaded) return;
    const currentIds = new Set(stuck.map((s) => s.id));
    // Ids stuck now that we've never surfaced before.
    const fresh = stuck.filter((s) => !notifiedRef.current.has(s.id));
    // Prune the notified set to entries that still exist, so a future
    // brand-new id (never the same one) can nag exactly once.
    const pruned = [...notifiedRef.current].filter((id) => currentIds.has(id));

    if (fresh.length > 0) {
      const next = new Set([...pruned, ...fresh.map((f) => f.id)]);
      notifiedRef.current = next;
      saveNotified([...next]);
      setActiveIds((prev) => new Set([...prev, ...fresh.map((f) => f.id)]));
      setToasts((prev) => [...prev, ...fresh]);
    } else if (pruned.length !== notifiedRef.current.size) {
      notifiedRef.current = new Set(pruned);
      saveNotified(pruned);
    }
  }, [stuck, notifiedLoaded]);

  // Auto-dismiss toasts oldest-first.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(1)), TOAST_MS);
    return () => clearTimeout(t);
  }, [toasts]);

  if (!stuck) return null;

  const activeItems = stuck.filter((s) => activeIds.has(s.id));
  const headline =
    activeItems.length === 1
      ? activeItems[0].label
      : `${activeItems.length} changes didn't reach the server`;

  return (
    <>
      {activeItems.length > 0 && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
        >
          <div className="flex items-start gap-2">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <span>
              <strong className="font-semibold">{headline}</strong>
              {activeItems.length > 1 && (
                <span className="block text-xs text-red-700">
                  Including: {activeItems[0].label}
                </span>
              )}
              <span className="block text-xs text-red-700">
                It&apos;s saved on this device but not synced. Review it to
                retry or discard.
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={CONFLICTS_ROUTE}
              onClick={() => setActiveIds(new Set())}
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
            >
              Review
            </Link>
            <button
              type="button"
              onClick={() => setActiveIds(new Set())}
              aria-label="Dismiss"
              className="rounded-md p-1 text-red-700 hover:bg-red-100"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
          {toasts.map((t, i) => (
            <div
              key={`${t.id}-${i}`}
              role="status"
              className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-900 shadow-lg"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-red-500"
                />
                <span className="font-medium">{t.label}</span>
              </div>
              <Link
                href={CONFLICTS_ROUTE}
                className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Review
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
