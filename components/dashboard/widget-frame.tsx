"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";

const STORAGE_KEY = "gemcrm-dashboard-widgets-v1";

/**
 * Per-widget UI state persisted to localStorage.
 *   hidden     — user has removed the widget from the dashboard
 *   minimised  — collapsed to just a thin placeholder row
 */
export interface WidgetState {
  hidden: boolean;
  minimised: boolean;
}

type WidgetStateMap = Record<string, WidgetState>;

function readStore(): WidgetStateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as WidgetStateMap;
  } catch {
    // ignore
  }
  return {};
}

function writeStore(state: WidgetStateMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (private mode); silently no-op.
  }
}

const LISTENERS = new Set<() => void>();

function notify() {
  for (const fn of LISTENERS) fn();
}

/**
 * Hook that subscribes the caller to the widget store so other instances
 * (e.g. the Add-Widget picker) see live updates when state changes here.
 */
export function useWidgetStore(): {
  state: WidgetStateMap;
  setHidden: (id: string, hidden: boolean) => void;
  setMinimised: (id: string, minimised: boolean) => void;
} {
  const [state, setState] = useState<WidgetStateMap>(() => readStore());

  useEffect(() => {
    function refresh() {
      setState(readStore());
    }
    LISTENERS.add(refresh);
    return () => {
      LISTENERS.delete(refresh);
    };
  }, []);

  function setHidden(id: string, hidden: boolean) {
    const next: WidgetStateMap = {
      ...readStore(),
      [id]: { ...(state[id] ?? { hidden: false, minimised: false }), hidden },
    };
    writeStore(next);
    setState(next);
    notify();
  }
  function setMinimised(id: string, minimised: boolean) {
    const next: WidgetStateMap = {
      ...readStore(),
      [id]: {
        ...(state[id] ?? { hidden: false, minimised: false }),
        minimised,
      },
    };
    writeStore(next);
    setState(next);
    notify();
  }

  return { state, setHidden, setMinimised };
}

interface WidgetFrameProps {
  id: string;
  /** Used in the AddWidget picker + minimised label. */
  title: string;
  children: React.ReactNode;
}

/**
 * Renders the inner widget as-is, but overlays a tiny minimise/remove
 * control bar in the top-right on hover. When minimised, the widget body
 * is replaced by a slim header showing only the title, so it stays as a
 * placeholder the user can expand.
 *
 * The user's preferences persist via localStorage so the layout sticks
 * across sessions / reloads.
 */
export function WidgetFrame({ id, title, children }: WidgetFrameProps) {
  const { state, setHidden, setMinimised } = useWidgetStore();
  const isMobile = useIsMobile();
  // Avoid SSR/CSR hydration mismatch: until the component has mounted on
  // the client, render the default "expanded + visible" layout regardless
  // of what's in localStorage. Once hydrated we apply user preferences.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const raw = mounted
    ? state[id] ?? { hidden: false, minimised: false }
    : { hidden: false, minimised: false };
  // On mobile, ignore the user's desktop "minimised" preference — the
  // mobile view is curated and we never want a sad placeholder bar there.
  // The corresponding minimise button is also hidden on mobile (see below),
  // so this is only ever triggered by state set on desktop.
  const ws = isMobile ? { ...raw, minimised: false } : raw;

  if (ws.hidden) return null;

  if (ws.minimised) {
    // Single-row compact bar — sits at full column width so the grid
    // doesn't reflow oddly when a widget is collapsed.
    return (
      <div className="flex w-full items-center justify-between rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-gray-500">
          <GripIcon />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMinimised(id, false)}
            className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700"
            aria-label="Expand widget"
            title="Expand"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setHidden(id, true)}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Remove widget"
            title="Remove"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      {/* Drag handle hint in the top-left — visible on hover. Actual DnD
          wiring lives on the parent DashboardGrid slot. Hidden on mobile
          because touch can't drive HTML5 DnD anyway. */}
      <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 hidden text-gray-300 md:group-hover:block">
        <GripIcon />
      </span>

      {/* Hover-only control strip — minimise + remove. Desktop-only: the
          mobile dashboard is curated automatically, no per-widget chrome. */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 hidden items-center gap-1 opacity-0 transition-opacity md:flex md:group-hover:pointer-events-auto md:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setMinimised(id, true)}
          className="rounded-md bg-white/95 p-1 text-gray-400 shadow-sm ring-1 ring-gray-200 hover:text-gray-700"
          aria-label="Minimise widget"
          title="Minimise"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setHidden(id, true)}
          className="rounded-md bg-white/95 p-1 text-gray-400 shadow-sm ring-1 ring-gray-200 hover:text-red-600"
          aria-label="Remove widget"
          title="Remove"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  );
}

function GripIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="4" cy="4" r="1.2" />
      <circle cx="4" cy="8" r="1.2" />
      <circle cx="4" cy="12" r="1.2" />
      <circle cx="8" cy="4" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="8" cy="12" r="1.2" />
    </svg>
  );
}

interface AddWidgetMenuProps {
  registry: ReadonlyArray<{ id: string; title: string }>;
}

/**
 * "+ Add widget" picker. Lists any widgets the user has removed and
 * one-clicks them back into the dashboard. Hidden entirely when nothing
 * is hidden — keeps the dashboard chrome quiet by default.
 */
export function AddWidgetMenu({ registry }: AddWidgetMenuProps) {
  const { state, setHidden } = useWidgetStore();
  const [open, setOpen] = useState(false);
  const removed = registry.filter((r) => state[r.id]?.hidden);

  if (removed.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-brand hover:text-brand-darker"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add widget ({removed.length})
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {removed.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setHidden(w.id, false);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {w.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
