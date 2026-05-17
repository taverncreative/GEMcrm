"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { QuickActions } from "@/components/dashboard/quick-actions";

const SIDEBAR_KEY = "gemcrm-sidebar-collapsed";

export function AppShell({
  userEmail,
  children,
}: {
  userEmail: string;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") {
      setSidebarCollapsed(true);
    }
    setMounted(true);
  }, []);

  function toggleCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }

  function toggleMobileOpen() {
    setSidebarOpen((prev) => !prev);
  }

  return (
    <div className="flex h-full">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleCollapsed}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        mounted={mounted}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar userEmail={userEmail} onToggleSidebar={toggleMobileOpen} />
        {/* Persistent quick-actions bar — sits below the topbar on every
            route so booking / invoice / customer creation is always one
            click away. */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <QuickActions />
        </div>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
