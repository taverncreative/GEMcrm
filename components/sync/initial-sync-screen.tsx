"use client";

/**
 * Full-screen overlay shown during initial data pull (first login on
 * this device, or after a user-change wipe).
 *
 * Five per-entity tiles, each transitioning pending → syncing → done
 * (or error). On disconnect mid-load: shows a manual retry button so
 * the operator isn't stranded with a half-populated store.
 *
 * Pure presentation — orchestration lives in `<SyncBoot>`. This
 * component just receives state + callbacks.
 */

import type { PullResult } from "@/lib/sync/pull";

export type EntityName =
  | "customers"
  | "sites"
  | "jobs"
  | "agreements"
  | "tasks";

export type EntityState = "pending" | "syncing" | "done" | "error";

export interface InitialProgressState {
  customers: { state: EntityState; count: number };
  sites: { state: EntityState; count: number };
  jobs: { state: EntityState; count: number };
  agreements: { state: EntityState; count: number };
  tasks: { state: EntityState; count: number };
}

interface Props {
  progress: InitialProgressState;
  /** True if the initial pull halted because the device is offline.
   *  Distinct from `error` (server returned an error). */
  disconnected: boolean;
  error: string | null;
  onRetry: () => void;
}

const ENTITY_ORDER: EntityName[] = [
  "customers",
  "sites",
  "jobs",
  "agreements",
  "tasks",
];

const ENTITY_LABEL: Record<EntityName, string> = {
  customers: "Customers",
  sites: "Sites",
  jobs: "Jobs",
  agreements: "Agreements",
  tasks: "Tasks",
};

function StateIcon({ state }: { state: EntityState }) {
  if (state === "done") {
    return (
      <span className="text-brand-darker" aria-label="done">
        ✓
      </span>
    );
  }
  if (state === "syncing") {
    return (
      <span
        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-r-transparent"
        aria-label="syncing"
      />
    );
  }
  if (state === "error") {
    return (
      <span className="text-red-600" aria-label="error">
        ✕
      </span>
    );
  }
  return (
    <span className="text-gray-300" aria-label="pending">
      ○
    </span>
  );
}

export function InitialSyncScreen({
  progress,
  disconnected,
  error,
  onRetry,
}: Props) {
  return (
    <div
      role="dialog"
      aria-label="Initial sync"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white"
    >
      <div className="mx-auto w-full max-w-md px-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Loading your data…
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          First sync from the server. You can use the app once this
          finishes.
        </p>

        <ul className="mt-6 space-y-2">
          {ENTITY_ORDER.map((name) => {
            const p = progress[name];
            return (
              <li
                key={name}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
              >
                <span className="flex items-center gap-3 text-sm text-gray-700">
                  <StateIcon state={p.state} />
                  {ENTITY_LABEL[name]}
                </span>
                <span className="font-mono text-xs text-gray-400">
                  {p.state === "done"
                    ? `${p.count} fetched`
                    : p.state === "syncing"
                    ? "fetching…"
                    : p.state === "error"
                    ? "failed"
                    : "—"}
                </span>
              </li>
            );
          })}
        </ul>

        {disconnected && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Connection lost.</p>
            <p className="mt-1 text-xs text-amber-800">
              Initial sync was interrupted. It will resume automatically
              when you&apos;re back online, or tap below to retry now.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Retry
            </button>
          </div>
        )}

        {error && !disconnected && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium">Sync failed</p>
            <p className="mt-1 text-xs">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
