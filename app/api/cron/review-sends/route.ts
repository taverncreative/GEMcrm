/**
 * Cron entry point for the domestic-review auto-send pipeline.
 *
 * Scheduled in `vercel.json` (look for `/api/cron/review-sends`). Runs once
 * a day; idempotent — guarded by `customers.review_email_sent_at` so it
 * won't double-send to the same customer.
 *
 * Previously this was called as a side-effect of every dashboard load,
 * which meant 30+ invocations per active user per day, silent failures,
 * and unpredictable email timing. Now it runs on a schedule.
 *
 * Protection: requests must include `Authorization: Bearer <CRON_SECRET>`.
 * Vercel cron sets this automatically when `CRON_SECRET` is configured as
 * an env var in the project.
 */

import { NextResponse } from "next/server";
import { processDomesticReviewSends } from "@/lib/data/reviews";

export const runtime = "nodejs";
// Prevent caching — must execute every request.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Authorize: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
  // In dev (no CRON_SECRET set) we allow unauthenticated calls so the
  // endpoint can be hit manually for testing.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const sent = await processDomesticReviewSends();
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/review-sends] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
