-- 011_employee_number.sql | REVIEW BEFORE RUNNING. Not executed automatically. Additive. Run after 010b.
-- Optional official employee number for the technician ID card. Nothing is invented: it stays empty until an admin enters it.
begin;

alter table public.technicians add column if not exists employee_no text;
create unique index if not exists technicians_employee_no_uq on public.technicians (lower(btrim(employee_no)))
  where employee_no is not null and btrim(employee_no) <> '';

-- Portal views: columns are only APPENDED (CREATE OR REPLACE VIEW requires this); existing grants are kept.
create or replace view public.v_my_profile with (security_barrier = true) as
select t.first_name, t.middle_name, t.surname, c.name as company, d.name as designation, t.employment_status, t.date_hired,
       t.employee_no
  from public.technicians t
  left join public.companies c on c.id = t.company_id
  left join public.designations d on d.id = t.designation_id
 where t.id = public.my_technician_id();

create or replace view public.v_my_violations with (security_barrier = true) as
select v.id, v.violation_date, v.severity, v.status, v.description, v.retraining_required, v.corrective_action,
       a.name as action_taken,
       coalesce((select array_agg(vc.code order by vc.code) from public.violation_category_links l
                  join public.violation_categories vc on vc.id = l.category_id where l.violation_id = v.id), '{}') as category_codes,
       coalesce((select array_agg(vc.name order by vc.code) from public.violation_category_links l
                  join public.violation_categories vc on vc.id = l.category_id where l.violation_id = v.id), '{}') as category_names,
       (select count(*) from public.violation_evidence e where e.violation_id = v.id and e.visible_to_technician) as shared_evidence_count,
       v.created_at
  from public.violations v
  left join public.action_types a on a.id = v.action_taken_id
 where v.technician_id = public.my_technician_id();

commit;
