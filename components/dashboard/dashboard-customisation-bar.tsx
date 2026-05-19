"use client";

import { AddWidgetMenu } from "@/components/dashboard/widget-frame";

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
export const WIDGET_REGISTRY = [
  { id: "revenue-stats", title: "Revenue", desktopOnly: true },
  { id: "service-sheets-to-fill", title: "Service sheets to fill", desktopOnly: false },
  { id: "jobs-today", title: "Jobs today", desktopOnly: false },
  { id: "upcoming-visits", title: "Upcoming visits", desktopOnly: false },
  { id: "review-requests", title: "Request review", desktopOnly: true },
  { id: "customers-to-contact", title: "Customers to contact", desktopOnly: false },
  { id: "pma-renewals", title: "PMA renewals", desktopOnly: true },
  { id: "overdue-tasks", title: "Overdue tasks", desktopOnly: false },
  { id: "recent-activity", title: "Recent activity", desktopOnly: true },
  { id: "this-month-calendar", title: "This month calendar", desktopOnly: true },
] as const;

export function DashboardCustomisationBar() {
  // Customisation chrome is desktop-only — no drag-and-drop on touch, and
  // the mobile dashboard is curated automatically.
  return (
    <div className="hidden items-center justify-end md:flex">
      <AddWidgetMenu registry={WIDGET_REGISTRY} />
    </div>
  );
}
