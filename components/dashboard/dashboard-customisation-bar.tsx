"use client";

import { AddWidgetMenu } from "@/components/dashboard/widget-frame";
import { REVIEW_REQUESTS_ENABLED } from "@/lib/constants/feature-flags";

/**
 * Widget registry — kept in one place so the `Add widget` picker, the
 * dashboard layout and the DnD order persistence all agree.
 *
 * The order here is the default insertion order for brand-new users.
 * The user can then drag/minimise/remove freely; preferences persist to
 * localStorage.
 *
 * `desktopOnly: true` marks widgets that are admin / desk-tool by nature
 * (finance, audit log, contract chase, full-month calendar). These are
 * filtered out on mobile by `DashboardGrid` so the field operator's
 * phone view stays focused on what they need in the van. Desktop layout
 * is unaffected.
 */
interface WidgetRegistryEntry {
  id: string;
  title: string;
  desktopOnly: boolean;
}

export const WIDGET_REGISTRY: ReadonlyArray<WidgetRegistryEntry> = [
  { id: "revenue-stats", title: "Revenue", desktopOnly: true },
  { id: "service-sheets-to-fill", title: "Service sheets to fill", desktopOnly: false },
  { id: "jobs-to-invoice", title: "To invoice", desktopOnly: false },
  { id: "jobs-today", title: "Jobs today", desktopOnly: false },
  { id: "tasks-due", title: "Tasks due today", desktopOnly: false },
  // "upcoming-visits" is intentionally absent: it's now a featured,
  // full-width section at the top of the dashboard (see dashboard/page.tsx),
  // rendered outside the reorderable grid — so it's not customisable here.
  //
  // "Request review" is gated by REVIEW_REQUESTS_ENABLED (one feature, one
  // switch). OFF → not registered: gone from the Add-widget picker AND not
  // a valid id, so DashboardGrid drops it from any saved layout cleanly (no
  // empty slot). Combined with the widgets-array gate in dashboard/page.tsx,
  // flipping the flag back to true restores the widget AND the review-task
  // auto-creation together.
  ...(REVIEW_REQUESTS_ENABLED
    ? [{ id: "review-requests", title: "Request review", desktopOnly: true }]
    : []),
  { id: "customers-to-contact", title: "Customers to contact", desktopOnly: false },
  { id: "pma-renewals", title: "PMA renewals", desktopOnly: true },
  { id: "overdue-tasks", title: "Overdue tasks", desktopOnly: false },
  { id: "recent-activity", title: "Recent activity", desktopOnly: true },
  { id: "this-month-calendar", title: "This month calendar", desktopOnly: true },
];

export function DashboardCustomisationBar() {
  // Customisation chrome is desktop-only — no drag-and-drop on touch, and
  // the mobile dashboard is curated automatically.
  return (
    <div className="hidden items-center justify-end md:flex">
      <AddWidgetMenu registry={WIDGET_REGISTRY} />
    </div>
  );
}
