"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants/routes";

/**
 * RETIRED full-page customer profile → redirects to the side panel.
 *
 * The customer SIDE PANEL (the slide-over on the /customers list,
 * customer-side-panel.tsx) is the signed-off, offline-capable profile —
 * Dexie-backed, with New Booking and now Add Site. There shouldn't be two
 * profile surfaces, and this full page was an unconverted RSC route that
 * broke offline. So this route now just sends the user to /customers with
 * the customer pre-selected (?customer=id), which opens the panel —
 * dashboard Recent-Activity links land on the offline-capable panel, not a
 * dead server page.
 *
 * This is a CLIENT redirect (router.replace), NOT a server `redirect()`:
 * the service worker can't follow a 3xx navigation response, so a server
 * redirect lands the user on the offline shell even online. A plain 200
 * client page is served fine by the SW, then redirects on hydrate.
 */
export default function RetiredCustomerProfile() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";

  useEffect(() => {
    if (!id) {
      router.replace(ROUTES.CUSTOMERS);
      return;
    }
    router.replace(`${ROUTES.CUSTOMERS}?customer=${encodeURIComponent(id)}`);
  }, [id, router]);

  return null;
}
