"use client";

/**
 * Upgrade a draft to a real booking (Q3) — the route the draft's
 * "Upgrade to booking →" link points at.
 *
 * Reads the draft from Dexie (offline-capable, like the job detail page),
 * then mounts the shared <BookingModal> in attach-to-draft mode. The modal
 * UPDATEs this draft on confirm (sets site, generates the reference,
 * flips status draft → scheduled) rather than inserting a new job — see
 * makeBookingMeta in booking-modal.tsx.
 *
 * Navigation is a single, race-free funnel to the job detail page — which
 * is also the ONLY route that links here, so it doubles as "back":
 *   - draft missing / soft-deleted → jobs list
 *   - job is no longer a draft      → its detail page. This covers a hard
 *     refresh of an already-upgraded job AND a stale link, and it also
 *     fires the instant a successful upgrade flips the local row to
 *     'scheduled'. The modal's own success-onClose lands on the SAME
 *     detail page, so the two never fight over the navigation.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ROUTES } from "@/lib/constants/routes";
import { BookingModal } from "@/components/bookings/booking-modal";

export default function UpgradeDraftPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  // undefined = loading, null = missing/soft-deleted, Job = found.
  const draft = useLiveQuery(async () => {
    if (!id) return null;
    const j = await db.jobs.get(id);
    return j && !j.deleted_at ? j : null;
  }, [id]);

  useEffect(() => {
    if (draft === null) {
      router.replace(ROUTES.JOBS);
    } else if (draft && draft.job_status !== "draft") {
      router.replace(ROUTES.jobDetail(id));
    }
  }, [draft, id, router]);

  if (draft === undefined) {
    return (
      <div className="p-12 text-center text-sm text-gray-400">Loading…</div>
    );
  }
  // Missing, or no longer a draft → the effect above is redirecting.
  if (!draft || draft.job_status !== "draft") return null;

  return (
    <BookingModal
      open
      onClose={() => router.replace(ROUTES.jobDetail(id))}
      draftJobId={draft.id}
      presetCaptureNote={draft.capture_note ?? undefined}
      presetJobDate={draft.job_date}
      presetWindow={{
        start: draft.job_time ?? "",
        end: draft.job_time_end ?? "",
      }}
    />
  );
}
