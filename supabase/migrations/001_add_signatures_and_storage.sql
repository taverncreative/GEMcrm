-- Add signature columns to jobs table
alter table jobs add column if not exists technician_signature_url text;
alter table jobs add column if not exists client_signature_url text;

-- Create reports storage bucket (run in Supabase dashboard if not using CLI)
-- insert into storage.buckets (id, name, public) values ('reports', 'reports', true);
