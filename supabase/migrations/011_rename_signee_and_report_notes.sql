-- Rename signee_name → client_signatory_name on agreements
alter table agreements rename column signee_name to client_signatory_name;

-- Add report_notes to jobs
alter table jobs add column report_notes text;
