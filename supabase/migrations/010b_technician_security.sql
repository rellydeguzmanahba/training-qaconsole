-- 010b_technician_security.sql | REVIEW BEFORE RUNNING. Not executed automatically. Additive; no data is changed or deleted.
-- Prerequisite: 010a has been run (and committed). Run supabase/tests/technician_rls_test.sql afterwards (it rolls back).
--
-- Model
--   * A technician account has NO policy on any base table: they are denied by default.
--   * is_active_user() now means "active STAFF" (any role except technician), so every existing policy
--     (all tables, storage, views built with security_invoker) automatically excludes technicians.
--   * Technicians read only through whitelisted portal views/functions that derive the technician from
--     auth.uid() on the server (my_technician_id()). No ID from the browser is ever trusted.
--   * Account <-> technician links are created only by an admin through link_technician_account().
begin;

-- 1) Link table: one account <-> one technician, enforced by two uniqueness rules
create table if not exists public.technician_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  technician_id uuid not null unique references public.technicians(id),
  linked_by     uuid references auth.users(id),
  linked_at     timestamptz not null default now()
);
alter table public.technician_accounts enable row level security;
drop policy if exists p_select on public.technician_accounts;
create policy p_select on public.technician_accounts for select to authenticated
  using (public.has_role(array['admin']::public.app_role[]));
revoke all on public.technician_accounts from anon;
revoke insert, update, delete, truncate on public.technician_accounts from authenticated;   -- written only by the RPCs below
drop trigger if exists trg_audit on public.technician_accounts;
create trigger trg_audit after insert or update or delete on public.technician_accounts
  for each row execute function public.audit_row('user_id');

-- 2) Evidence a technician may see must be explicitly shared by QA/admin (default: not shared)
alter table public.violation_evidence add column if not exists visible_to_technician boolean not null default false;

-- 3) Identity helpers (SECURITY DEFINER, pinned search_path)
create or replace function public.my_technician_id() returns uuid
language sql stable security definer set search_path = public as $$
  select ta.technician_id
    from public.technician_accounts ta
    join public.profiles p    on p.user_id = ta.user_id and p.active and p.role = 'technician'
    join public.technicians t on t.id = ta.technician_id and t.employment_status not in ('Resigned', 'Terminated')
   where ta.user_id = auth.uid()
$$;

create or replace function public.is_technician() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active and role = 'technician')
$$;

-- every existing policy uses this function: it now excludes technician accounts
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active and role <> 'technician')
$$;

-- 4) Profile guard: technician role only via the link function; linked accounts cannot be re-roled silently
create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
declare other_admins int;
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.active then
      select count(*) into other_admins from public.profiles where role = 'admin' and active and user_id <> old.user_id;
      if other_admins = 0 then raise exception 'Cannot remove the last active admin'; end if;
    end if;
    return old;
  end if;
  if new.user_id <> old.user_id then raise exception 'user_id cannot be changed'; end if;
  if auth.uid() is not null and not public.has_role(array['admin']::public.app_role[])
     and (new.role <> old.role or new.active <> old.active) then
    raise exception 'Only an admin can change role or active status';
  end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    select count(*) into other_admins from public.profiles where role = 'admin' and active and user_id <> old.user_id;
    if other_admins = 0 then raise exception 'Cannot demote or deactivate the last active admin'; end if;
  end if;
  if auth.uid() is not null then
    if new.role = 'technician' and old.role <> 'technician'
       and not exists (select 1 from public.technician_accounts where user_id = new.user_id) then
      raise exception 'Use "Link technician account" to give an account the technician role';
    end if;
    if old.role = 'technician' and new.role <> 'technician'
       and exists (select 1 from public.technician_accounts where user_id = old.user_id) then
      raise exception 'Unlink the technician account before changing its role';
    end if;
  end if;
  return new;
end $$;

-- 5) Admin-only provisioning (explicit user id; email is shown for the admin to verify, never used to auto-match)
create or replace function public.admin_list_accounts()
returns table (user_id uuid, email text, email_confirmed boolean, last_sign_in_at timestamptz, full_name text,
               role public.app_role, active boolean, technician_id uuid, technician_name text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Not allowed'; end if;
  return query
    select u.id, u.email::text, (u.email_confirmed_at is not null), u.last_sign_in_at, p.full_name, p.role, p.active, ta.technician_id,
           nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.surname, '')), '')
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      left join public.technician_accounts ta on ta.user_id = u.id
      left join public.technicians t on t.id = ta.technician_id
     order by u.email;
end $$;

create or replace function public.link_technician_account(p_user_id uuid, p_technician_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role public.app_role; v_status public.employment_status; v_confirmed timestamptz;
begin
  if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Not allowed'; end if;
  select role into v_role from public.profiles where user_id = p_user_id;
  if not found then raise exception 'This account has no profile'; end if;
  if v_role not in ('viewer', 'technician') then raise exception 'Only viewer or technician accounts can be linked (this one is %)', v_role; end if;
  select email_confirmed_at into v_confirmed from auth.users where id = p_user_id;
  if v_confirmed is null then raise exception 'The account email is not verified yet'; end if;
  select employment_status into v_status from public.technicians where id = p_technician_id;
  if not found then raise exception 'Technician not found'; end if;
  if v_status in ('Resigned', 'Terminated') then raise exception 'Deactivated employees cannot be given portal access'; end if;
  if exists (select 1 from public.technician_accounts where user_id = p_user_id) then raise exception 'This account is already linked'; end if;
  if exists (select 1 from public.technician_accounts where technician_id = p_technician_id) then raise exception 'This technician already has a linked account'; end if;
  insert into public.technician_accounts (user_id, technician_id, linked_by) values (p_user_id, p_technician_id, auth.uid());
  update public.profiles set role = 'technician', active = true where user_id = p_user_id;
end $$;

create or replace function public.unlink_technician_account(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Not allowed'; end if;
  delete from public.technician_accounts where user_id = p_user_id;
  if not found then raise exception 'No linked technician account for this user'; end if;
  update public.profiles set role = 'viewer', active = false where user_id = p_user_id;     -- access ends; admin can re-activate deliberately
end $$;

-- 6) Technician portal reads: whitelisted columns, own records only. Internal fields (remarks, recommendations,
--    reporter names, IBAS/JO numbers, audit/auth ids, decision notes, review flags) are deliberately NOT exposed.
create or replace view public.v_my_profile with (security_barrier = true) as
select t.first_name, t.middle_name, t.surname, c.name as company, d.name as designation, t.employment_status, t.date_hired
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
       (select count(*) from public.violation_evidence e where e.violation_id = v.id and e.visible_to_technician) as shared_evidence_count
  from public.violations v
  left join public.action_types a on a.id = v.action_taken_id
 where v.technician_id = public.my_technician_id();

create or replace view public.v_my_evidence with (security_barrier = true) as
select e.id, e.violation_id, e.file_name, case when e.external_url is not null then 'link' else 'file' end as kind,
       e.external_url, e.storage_path, e.created_at
  from public.violation_evidence e
  join public.violations v on v.id = e.violation_id
 where e.visible_to_technician and v.technician_id = public.my_technician_id();

create or replace view public.v_my_retrainings with (security_barrier = true) as
select r.id, r.violation_id, tt.name as training, r.retraining_date, r.trainer, r.result, r.created_at
  from public.retrainings r
  join public.training_types tt on tt.id = r.training_type_id
 where r.technician_id = public.my_technician_id();

-- Offense-derived data comes from the existing engine (no second calculation). These run as owner because the engine
-- reads RLS-protected tables; each one filters strictly by my_technician_id().
create or replace function public.my_monitoring()
returns table (monitoring_status text, current_offense_no int, chain_start date, last_offense_date date, monitoring_until date,
               monitoring_days int, elapsed_days int, remaining_days int, current_penalty text, deployment_status text,
               hold_until date, pending_approvals int)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_technician_id() as id),
  cfg as (select coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'monitoring_days'), 30) as days,
                 public.ph_today() as today),
  cs as (select max(c.offense_date) as d from public.offense_chain((select id from me)) c
          where c.chain_start and (select id from me) is not null)
  select s.monitoring_status, s.current_offense_no::int, (select d from cs), s.last_offense_date, s.monitoring_until, cfg.days,
         case when s.monitoring_status = 'UNDER MONITORING' then least(cfg.days, greatest(0, cfg.today - s.last_offense_date)) end,
         case when s.monitoring_status = 'UNDER MONITORING' then greatest(0, s.monitoring_until - cfg.today) end,
         s.current_penalty, s.deployment_status, s.hold_until, s.pending_approvals::int
    from public.v_offense_status s
   cross join cfg
   where s.technician_id = (select id from me) and (select id from me) is not null
$$;

create or replace function public.my_penalties()
returns table (offense_date date, offense_no int, severity_group text, penalty text, hold_days int, hold_until date,
               approval_status text, enforced boolean, lifted boolean, violation_id uuid)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_technician_id() as id)
  select c.offense_date, c.offense_no::int, c.severity_group::text, c.penalty, c.hold_days,
         case when c.hold_days > 0 then c.offense_date + c.hold_days end,
         oa.status::text,
         coalesce(oa.status = 'approved' and oa.lifted_at is null and (oa.hold_until is null or oa.hold_until >= public.ph_today()), false),
         (oa.lifted_at is not null),
         c.first_violation_id
    from me
   cross join lateral public.offense_chain(me.id) c
    left join public.offense_actions oa on oa.technician_id = c.technician_id and oa.offense_date = c.offense_date
   where me.id is not null and c.technician_id = me.id and oa.status is distinct from 'rejected'
   order by c.offense_date desc
$$;

-- 7) Storage: a technician may open only evidence QA explicitly shared on their own violations
create or replace function public.technician_can_read_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.violation_evidence ve join public.violations v on v.id = ve.violation_id
                  where ve.storage_path = p_name and ve.visible_to_technician and v.technician_id = public.my_technician_id())
$$;
drop policy if exists evidence_read_technician on storage.objects;
create policy evidence_read_technician on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.technician_can_read_object(name));

-- 8) Privileges
revoke all on public.v_my_profile, public.v_my_violations, public.v_my_evidence, public.v_my_retrainings from anon, public;
grant select on public.v_my_profile, public.v_my_violations, public.v_my_evidence, public.v_my_retrainings to authenticated;
revoke execute on function public.my_technician_id(), public.is_technician(), public.my_monitoring(), public.my_penalties(),
  public.technician_can_read_object(text), public.admin_list_accounts(), public.link_technician_account(uuid, uuid),
  public.unlink_technician_account(uuid) from public, anon;
grant execute on function public.my_technician_id(), public.is_technician(), public.my_monitoring(), public.my_penalties(),
  public.technician_can_read_object(text), public.admin_list_accounts(), public.link_technician_account(uuid, uuid),
  public.unlink_technician_account(uuid) to authenticated;

commit;
