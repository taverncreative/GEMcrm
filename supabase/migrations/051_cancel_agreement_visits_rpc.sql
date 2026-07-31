-- 051: cancel_agreement_visits SECURITY DEFINER RPC
-- ============================================================
-- Cancelling an agreement was a bare `update({status})` — nothing anywhere
-- reacted to it, so a cancelled contract left every generated visit sitting
-- on the calendar as scheduled work, months out. Confirmed in prod: one
-- cancelled agreement with 7 future visits still booked, running to June
-- 2027. Nate's request: "need all future visits to disappear if an
-- agreement is cancelled".
--
-- WHICH VISITS GO, and why the predicate is here rather than in app code:
--
--   job_status = 'scheduled'  — a COMPLETED visit is the record of work
--     actually performed (and may carry a service sheet and an invoice
--     line); an IN_PROGRESS one is a sheet being filled at the site right
--     now. Neither is ever touched. Putting that in the WHERE clause makes
--     it a property of the database, not of whichever caller happens to be
--     asking — the same reasoning that keeps the live-agreement guard
--     inside soft_delete_site (050).
--
--   job_date >= p_from_date  — future visits go, PAST-dated scheduled ones
--     stay. A past scheduled visit is a missed visit that still needs
--     writing up; it already surfaces on the dashboard's overdue list, and
--     removing it would destroy the operator's own to-do. The cut-off is a
--     PARAMETER, not `current_date`, because cancelling is offline-capable:
--     the operator's device captures the date at the moment they press
--     Cancel and it rides the outbox entry, so a replay three days later
--     removes the set they SAW rather than a recomputed one. A visit dated
--     today is on the removed side of `>=` — if it had been worked it would
--     already be in_progress or completed, and the operator cancelling the
--     contract right now is the best available signal it is not happening.
--
--   deleted_at is null       — makes a replay a no-op, exactly like the
--     soft_delete_* family.
--
-- ONE-WAY. These are soft deletes and nothing regenerates them: no status
-- change calls generateAgreementJobs, so re-activating a cancelled
-- agreement does NOT bring its visits back. The confirm dialog says so
-- outright rather than letting the operator discover it.
--
-- Soft delete throughout — 039 revoked hard DELETE on jobs and this changes
-- nothing about that. The removed rows keep flowing through sync_pull_jobs
-- (030, definer, sees past the RLS deleted_at filter) so the tombstones
-- reach every device on the next pull.
--
-- Security shape is the 050 template verbatim: definer, in-body auth.uid()
-- guard, search_path pinned, EXECUTE revoked from public + anon and granted
-- only to authenticated.

create or replace function public.cancel_agreement_visits(
  p_agreement_id uuid,
  p_from_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'cancel_agreement_visits: not authenticated';
  end if;

  update public.jobs
     set deleted_at = now()
   where agreement_id = p_agreement_id
     and deleted_at is null
     and job_status = 'scheduled'
     and job_date >= p_from_date;
end;
$$;

revoke all on function public.cancel_agreement_visits(uuid, date) from public;
revoke all on function public.cancel_agreement_visits(uuid, date) from anon;
grant execute on function public.cancel_agreement_visits(uuid, date) to authenticated;

-- Rollback:
--   drop function if exists public.cancel_agreement_visits(uuid, date);
