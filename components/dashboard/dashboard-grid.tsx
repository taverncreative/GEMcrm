"use client";

import { useCallback, useEffect, useState } from "react";
import { useWidgetStore } from "@/components/dashboard/widget-frame";
import { WIDGET_REGISTRY } from "@/components/dashboard/dashboard-customisation-bar";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";

const ORDER_KEY = "gemcrm-dashboard-widget-order-v1";

function readOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v) => typeof v === "string") as string[];
    }
  } catch {
    // ignore
  }
  return [];
}

function writeOrder(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

// Set is typed as `Set<string>` (not the literal union of the registry
// ids) so the caller can pass an arbitrary widget id without TS complaining.
const DESKTOP_ONLY_IDS: ReadonlySet<string> = new Set(
  WIDGET_REGISTRY.filter((w) => w.desktopOnly).map((w) => w.id)
);

interface DashboardGridProps {
  /** Render slots, keyed by widget id. The grid handles order + DnD. */
  widgets: Array<{ id: string; node: React.ReactNode }>;
}

/**
 * Reorderable column-flow widget grid.
 *
 * Why column-flow rather than CSS grid:
 *   - When a widget is removed or minimised, regular `grid-cols-2` leaves
 *     a gap in that row. With `columns-1 md:columns-2` and `break-inside:
 *     avoid` we get masonry-style compacting for free.
 *   - Each widget sits at full column width even when minimised, matching
 *     the user request: "minimised widgets stay the same size".
 *
 * Order is held in localStorage as an array of widget ids. New widgets
 * (added in the registry after a user has already saved an order) fall in
 * at the end. Hidden widgets are filtered out by WidgetFrame itself.
 *
 * Mobile behaviour:
 *   - `desktopOnly` widgets (Revenue, Calendar, Recent Activity, PMA
 *     widgets, Review requests) are filtered out — the field operator's
 *     phone view stays focused on what they need in the van.
 *   - Drag-and-drop is stripped — HTML5 DnD doesn't fire on touch, so
 *     wiring it up just bloats the DOM and exposes phantom controls.
 *
 * DnD on desktop is plain HTML5 — no lib. Drag handle is the top-left
 * corner of each widget, exposed by the wrapper (not the widget itself),
 * so each widget stays a click-through target.
 */
export function DashboardGrid({ widgets }: DashboardGridProps) {
  const { state: widgetState } = useWidgetStore();
  const isMobile = useIsMobile();

  // Default order = registry order. On mount, replace with any saved order
  // from localStorage. Done in a post-mount effect to avoid SSR/CSR
  // hydration mismatches.
  const [order, setOrder] = useState<string[]>(() => widgets.map((w) => w.id));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = readOrder();
    if (saved.length > 0) {
      const validIds = new Set(widgets.map((w) => w.id));
      const seen = new Set(saved);
      const extras = widgets.map((w) => w.id).filter((id) => !seen.has(id));
      setOrder([...saved.filter((id) => validIds.has(id)), ...extras]);
    }
    setMounted(true);
    // We only want to do this once on mount — widgets list itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mounted) return;
    writeOrder(order);
  }, [order, mounted]);

  const onDrop = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(sourceId);
      const toIdx = next.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, sourceId);
      return next;
    });
  }, []);

  const ordered = order
    .map((id) => widgets.find((w) => w.id === id))
    .filter((w): w is { id: string; node: React.ReactNode } => Boolean(w));

  // Hidden widgets render as nothing (still in the order array so re-adding
  // them keeps the original position). On mobile, also drop desk-only ones.
  const visible = ordered.filter((w) => {
    if (widgetState[w.id]?.hidden) return false;
    if (isMobile && DESKTOP_ONLY_IDS.has(w.id)) return false;
    return true;
  });

  return (
    <div className="columns-1 gap-6 md:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
      {visible.map((w) => (
        <DragSlot
          key={w.id}
          id={w.id}
          onDrop={onDrop}
          draggable={!isMobile}
        >
          {w.node}
        </DragSlot>
      ))}
    </div>
  );
}

function DragSlot({
  id,
  onDrop,
  draggable,
  children,
}: {
  id: string;
  onDrop: (sourceId: string, targetId: string) => void;
  /** When false (mobile), all DnD handlers + the grip handle are stripped. */
  draggable: boolean;
  children: React.ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);

  // Mobile: render a plain wrapper. No DnD handlers, no grip overlay.
  if (!draggable) {
    return <div className="relative rounded-xl">{children}</div>;
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-gemcrm-widget-id", id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/x-gemcrm-widget-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const src = e.dataTransfer.getData("text/x-gemcrm-widget-id");
        setDragOver(false);
        if (src) onDrop(src, id);
      }}
      className={`relative rounded-xl transition-shadow ${
        dragOver ? "ring-2 ring-brand ring-offset-2" : ""
      }`}
    >
      {/* Tiny grip handle in the top-left — visible on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1.5 top-1.5 z-10 hidden text-gray-300 group-hover:flex"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="4" cy="4" r="1.2" />
          <circle cx="4" cy="8" r="1.2" />
          <circle cx="4" cy="12" r="1.2" />
          <circle cx="8" cy="4" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="8" cy="12" r="1.2" />
        </svg>
      </span>
      {children}
    </div>
  );
}
