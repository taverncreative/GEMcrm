import { notFound } from "next/navigation";
import { DbSmokeTester } from "@/components/dev/db-smoke-tester";

/**
 * Throwaway dev page for verifying the local IndexedDB store works.
 *
 * Gated to development with `notFound()` in production builds so the
 * route returns 404 if someone hits it on the deployed app. Safe to
 * leave in the repo — production users will never see it, and it's
 * useful for sanity-checking the local store during the offline-pwa
 * rollout.
 *
 * Reachable at /dev/db-smoke when running `npm run dev`.
 */
export default function DbSmokePage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900">
        Local DB smoke test
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        Direct Dexie reads + writes — bypasses every server action. For
        verifying the local store works end-to-end. Dev-only; this page
        returns 404 in production.
      </p>
      <div className="mt-6">
        <DbSmokeTester />
      </div>
    </div>
  );
}
