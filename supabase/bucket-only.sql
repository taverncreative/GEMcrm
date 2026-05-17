-- Storage bucket setup — run this on an existing project.
-- ============================================================
-- This is the bucket block extracted from setup.sql so you can run it
-- without re-creating tables that already exist.
--
-- Just paste this whole file into the Supabase SQL Editor and click Run.
-- Safe to re-run: each statement is idempotent.

-- 1) The bucket itself (public so emailed PDF links work).
insert into storage.buckets (id, name, public)
  values ('reports', 'reports', true)
on conflict (id) do nothing;

-- 2) Policies — let authenticated users upload/update/delete; let anyone read.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can upload reports'
  ) then
    create policy "Authenticated users can upload reports"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'reports');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can update reports'
  ) then
    create policy "Authenticated users can update reports"
      on storage.objects for update
      to authenticated
      using (bucket_id = 'reports')
      with check (bucket_id = 'reports');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can delete reports'
  ) then
    create policy "Authenticated users can delete reports"
      on storage.objects for delete
      to authenticated
      using (bucket_id = 'reports');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Anyone can read reports'
  ) then
    create policy "Anyone can read reports"
      on storage.objects for select
      to public
      using (bucket_id = 'reports');
  end if;
end $$;
