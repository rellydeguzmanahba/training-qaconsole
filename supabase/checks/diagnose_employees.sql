-- diagnose_employees.sql | READ-ONLY. Run BEFORE 009. One result table.
select check_name, value from (
  select 1 n, 'technicians columns' check_name, (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'technicians') value
  union all select 2, 'has_lms_account column exists', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'technicians' and column_name = 'has_lms_account'))::text
  union all select 3, 'employment_status values', (select string_agg(enumlabel, ', ' order by enumsortorder) from pg_enum where enumtypid = 'public.employment_status'::regtype)
  union all select 4, 'access_systems', coalesce((select string_agg(name || case when active then '' else ' (inactive)' end, ', ' order by name) from public.access_systems), 'EMPTY')
  union all select 5, 'companies / designations', (select count(*) from public.companies) || ' / ' || (select count(*) from public.designations)
  union all select 6, 'technicians: total / active staff / no company / no designation / no hire date / no mobile / no email / lms_user filled',
         (select concat_ws(' / ', count(*), count(*) filter (where employment_status in ('Probationary','Regular')), count(*) filter (where company_id is null),
            count(*) filter (where designation_id is null), count(*) filter (where date_hired is null), count(*) filter (where mobile is null),
            count(*) filter (where email is null), count(*) filter (where lms_user is not null)) from public.technicians)
  union all select 7, 'lms_user distinct values', coalesce((select string_agg(distinct lms_user, ', ') from public.technicians where lms_user is not null), 'none')
  union all select 8, 'technician_access rows by system', coalesce((select string_agg(s.name || '=' || c, ', ') from (select a.name, count(*) c from public.technician_access ta join public.access_systems a on a.id = ta.access_id group by a.name) s), 'none')
  union all select 9, 'triggers on technicians', (select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.technicians'::regclass and not tgisinternal)
  union all select 10, 'policies: technicians / technician_access', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'technicians') || ' / ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'technician_access')
  union all select 11, 'PROTECTED COUNTS technicians / violations / training_records / retrainings / evidence / profiles / auth.users',
         concat_ws(' / ', (select count(*) from public.technicians), (select count(*) from public.violations), (select count(*) from public.training_records),
           (select count(*) from public.retrainings), (select count(*) from public.violation_evidence), (select count(*) from public.profiles), (select count(*) from auth.users))
) t order by n;
