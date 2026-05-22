/**
 * Backoff scheduling for outbox + photo retries.
 *
 * Exponential with 20% jitter, capped at 60s.
 *
 *   attempts = 0  → ~1s
 *   attempts = 1  → ~2s
 *   attempts = 2  → ~4s
 *   attempts = 3  → ~8s
 *   attempts = 4  → ~16s
 *   attempts = 5  → ~32s
 *   attempts = 6+ → ~60s (cap)
 *
 * Pure — easy to unit-test, no Date.now() side effect except in the
 * return value computation (which is the only purpose of the function).
 */
export function nextAttemptAt(attempts: number, nowMs: number = Date.now()): string {
  const base = Math.min(60_000, 1000 * Math.pow(2, attempts));
  // ±20% jitter prevents thundering-herd when many entries become eligible
  // at once (e.g. after a connection comes back).
  const jitter = base * (0.8 + Math.random() * 0.4);
  return new Date(nowMs + jitter).toISOString();
}
