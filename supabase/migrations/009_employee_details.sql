-- 009_employee_details.sql | ADDITIVE. Nothing is dropped, renamed, truncated or deleted.
begin;

-- 1) "LMS User" is a Yes/No in the Employee Details sheet. lms_user / lms_login (text) stay untouched.
alter table public.technicians add column if not exists has_lms_account boolean not null default false;
update public.technicians set has_lms_account = true
 where not has_lms_account and lower(trim(coalesce(lms_user, ''))) in ('yes', 'y', 'true', '1');

-- 2) Only an admin may deactivate (Resigned/Terminated) or reactivate an employee. API users only:
--    SQL-editor / owner sessions (auth.uid() is null) are unaffected.
create or replace function public.guard_employee_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.employment_status is distinct from old.employment_status
     and (new.employment_status in ('Resigned', 'Terminated') or old.employment_status in ('Resigned', 'Terminated'))
     and not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can deactivate or reactivate an employee';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_status on public.technicians;
create trigger trg_guard_status before update on public.technicians
  for each row execute function public.guard_employee_status();

commit;
