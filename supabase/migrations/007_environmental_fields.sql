-- Add environmental risk fields to jobs
-- Run this in the Supabase SQL Editor

alter table jobs add column environmental_risk text;
alter table jobs add column environmental_comments text;
alter table jobs add column protected_species_present boolean not null default false;
