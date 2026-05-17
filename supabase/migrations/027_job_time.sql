-- 027: Booked-in time on jobs
-- ============================================================
-- `job_date` only carries the calendar day. Operators want to know what
-- TIME a visit is booked for — so it shows on the dashboard widgets and
-- they can sequence the day's work.
--
-- Nullable: legacy jobs and bookings where the time isn't known yet
-- (e.g. "morning, will confirm") render as "All day" in the UI.
-- `time without time zone` is correct here — these are clock times in the
-- local working day, not absolute moments.

alter table jobs add column if not exists job_time time;
