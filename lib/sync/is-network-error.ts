/**
 * Detect a thrown error that looks like a transport-layer failure.
 *
 * Used in two places that need to distinguish "we couldn't reach the
 * server" from "the server told us something":
 *
 *   - `lib/actions/graceful.ts` — wraps form actions / direct calls
 *     to convert network-shape throws into a graceful
 *     `{success:false, message:"…connection lost…"}` result.
 *
 *   - `app/(app)/error.tsx` — secondary signal (alongside the
 *     primary `useIsOnline() === false`) when the React error
 *     boundary catches a fetch failure thrown out of an unconverted
 *     RSC page. The primary signal is `useIsOnline()` because
 *     Next.js sanitises server-component error messages in
 *     production builds, so the client error boundary CAN'T rely on
 *     reading "TypeError: fetch failed" from the error object — it
 *     only ever sees the digest. This helper is the secondary catch
 *     for the rare online-but-network-error case in dev (where the
 *     raw message IS visible).
 *
 * The check is deliberately wide. False positives only mean a real
 * server-side error gets shown as "connection lost" instead of its
 * actual text — annoying but recoverable. False negatives (treating
 * a network error as a regular bug) are worse: the operator sees a
 * generic crash screen instead of an actionable "check your
 * connection" message.
 *
 * Pattern coverage:
 *   - Chrome:  TypeError("Failed to fetch") / TypeError("fetch failed")
 *   - Firefox: TypeError("NetworkError when attempting to fetch resource.")
 *   - Safari:  TypeError("Load failed")
 *   - Node (Next.js server-side fetch): TypeError("fetch failed")
 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("failed to fetch")
  ) {
    return true;
  }
  // Bare TypeError is a strong signal in fetch contexts — Chrome
  // throws TypeError specifically when the network layer rejects.
  return err.name === "TypeError";
}
