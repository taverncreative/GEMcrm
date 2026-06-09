"use client";

import { useEffect } from "react";

/**
 * Registers the hand-rolled service worker (public/sw.js) — PROD ONLY.
 *
 * In dev we deliberately do NOT register: a SW + Turbopack HMR fight each
 * other, and dev has no prefetch anyway. So dev keeps today's behaviour
 * (soft-nav can dino offline in dev — expected); the SW only runs in a
 * production build (`next build && next start`, and Vercel).
 *
 * Renders nothing. Mounted once in the root layout. Registration is
 * deferred to `load` so it never contends with first render / hydration.
 *
 * NOTE: this does NOT add background sync — the outbox still drains only
 * while the app is open and online (unchanged). The SW only caches the
 * app shell / routes for offline navigation.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("[sw] registration failed:", err);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
