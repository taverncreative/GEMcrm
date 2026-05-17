"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { BookingModal } from "@/components/bookings/booking-modal";

const ACTIONS = [
  {
    label: "New Booking",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
    action: "start-job" as const,
  },
  {
    label: "Add Customer",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
      </svg>
    ),
    href: ROUTES.CUSTOMERS_NEW,
  },
  {
    label: "Agreements",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
    href: ROUTES.AGREEMENTS,
  },
] as const;

export function MobileFab() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      {/* FAB — only visible on mobile */}
      <div className="fixed bottom-6 right-6 z-40 sm:hidden">
        {/* Action menu */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute bottom-16 right-0 mb-2 flex flex-col items-end gap-2">
              {ACTIONS.map((action) => {
                const button = (
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-md">
                      {action.label}
                    </span>
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-700 shadow-md">
                      {action.icon}
                    </div>
                  </div>
                );

                if ("action" in action && action.action === "start-job") {
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setJobModalOpen(true);
                      }}
                    >
                      {button}
                    </button>
                  );
                }

                if ("href" in action) {
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        router.push(action.href);
                      }}
                    >
                      {button}
                    </button>
                  );
                }

                return null;
              })}
            </div>
          </>
        )}

        {/* Main FAB button */}
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
            menuOpen
              ? "rotate-45 bg-gray-900 text-white"
              : "bg-brand text-white hover:bg-brand-dark"
          }`}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      <BookingModal
        open={jobModalOpen}
        onClose={() => setJobModalOpen(false)}
      />
    </>
  );
}
