-- Add Field Ops to Account Access options used by Add/Edit Technician.
-- Run on the AHBA Training & QA Console Supabase database (not Warehouse SAP).
-- The technician form reads access_systems dynamically; no frontend hardcoding is needed.
insert into public.access_systems (name, active)
select 'Field Ops', true
where not exists (
  select 1 from public.access_systems
  where lower(btrim(name)) = lower('Field Ops')
);

update public.access_systems
set active = true
where lower(btrim(name)) = lower('Field Ops') and active is distinct from true;
