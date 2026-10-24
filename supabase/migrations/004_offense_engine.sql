-- 004_offense_engine.sql | Offense chain, penalties, supervisor approval, deployment eligibility
-- Run AFTER 001, 005, 002, 003.
--
-- RULES IMPLEMENTED (defaults from the workbook's "Violation Rules" sheet; confirm or change):
--  R1  Only violations with retraining_required = true count as offenses.
--  R2  Offense days: several counted violations on the SAME date = ONE offense (highest severity wins).
--  R3  Rolling chain: next offense # if the gap from the previous offense date is <= monitoring_days
--      (settings.monitoring_days, default 30, inclusive). Otherwise the chain restarts at 1st.
--  R4  Critical uses the Major penalty column.
--  R5  5th offense = BANNED. Chain never auto-clears once offense # 5 is reached; only lift_ban() resets it
--      (violations dated on/before the lift date are then ignored). NOT based on lifetime violation count.
--  R6  Hold days run from the offense date: hold_until = offense_date + hold_days (values in penalty_rules;
--      3rd Major = 3 days as stored in the workbook; edit penalty_rules to change).
--  R7  Restrictions (hold_days > 0, or ban) are created as 'proposed' offense_actions and take effect ONLY
--      after supervisor/admin approval. Warnings/retraining need no approval.
--  R8  "Requires review" = a restriction awaiting approval, OR offense # >= 3 under monitoring,
--      OR a violation endorsed 'For Retraining' with no retraining recorded.

-- ---------- Schema additions ----------
alter table public.offense_actions
  add column if not exists offense_date date,
  add column if not exists lifted_at   timestamptz,
  add column if not exists lifted_by   uuid references auth.users(id),
  add column if not exists lift_reason text;
alter table public.offense_actions alter column offense_date set not null;
create index if not exists offense_actions_date_idx on public.offense_actions (technician_id, offense_date);

alter default privileges in schema public revoke all on tables from anon;

create or replace function public.ph_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- ---------- Guard update: allow the engine's own updates ----------
create or replace function public.guard_offense_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.engine', true), '') <> '1' then
    if old.status <> 'proposed' then raise exception 'This offense action was already decided'; end if;
    if new.status not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;

-- ---------- Offense chain (computed live from violations) ----------
create or replace function public.offense_chain(p_technician uuid default null)
returns table (
  technician_id uuid, offense_date date, is_major boolean, violations_count int,
  first_violation_id uuid, offense_no smallint, severity_group public.severity_group,
  penalty text, hold_days int, chain_start boolean
)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare
  v_days int; v_ban smallint; v_tech uuid; v_prev date; v_cur smallint := 0;
  r record; pr record; sg public.severity_group; cs boolean;
begin
  select coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'monitoring_days'), 30) into v_days;
  select max(p.offense_no) into v_ban from public.penalty_rules p;

  for r in
    select v.technician_id as tid, v.violation_date as d,
           bool_or(v.severity in ('Major','Critical')) as major,
           count(*)::int as cnt,
           (array_agg(v.id order by v.created_at, v.id))[1] as first_id
      from public.violations v
     where v.retraining_required
       and (p_technician is null or v.technician_id = p_technician)
       and v.violation_date > coalesce((
             select max((oa.lifted_at at time zone 'Asia/Manila')::date)
               from public.offense_actions oa
              where oa.technician_id = v.technician_id and oa.lifted_at is not null), date '1900-01-01')
     group by v.technician_id, v.violation_date
     order by v.technician_id, v.violation_date
  loop
    if v_tech is distinct from r.tid then v_tech := r.tid; v_prev := null; v_cur := 0; end if;
    if v_prev is null or (v_cur < v_ban and (r.d - v_prev) > v_days) then
      v_cur := 1; cs := true;
    else
      v_cur := least(v_cur + 1, v_ban)::smallint; cs := false;
    end if;
    v_prev := r.d;
    sg := case when r.major then 'Major' else 'Minor' end;
    select p.penalty, p.hold_days into pr
      from public.penalty_rules p where p.offense_no = v_cur and p.severity_group = sg;

    technician_id := r.tid; offense_date := r.d; is_major := r.major; violations_count := r.cnt;
    first_violation_id := r.first_id; offense_no := v_cur; severity_group := sg;
    penalty := coalesce(pr.penalty, 'No rule defined'); hold_days := coalesce(pr.hold_days, 0);
    chain_start := cs;
    return next;
  end loop;
end $$;

-- ---------- Sync restriction proposals (security definer; internal) ----------
create or replace function public.sync_offense_actions(p_technician uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; ex record; v_ban smallint;
begin
  perform set_config('app.engine', '1', true);
  if p_technician is not null then perform pg_advisory_xact_lock(hashtext(p_technician::text)); end if;
  select max(offense_no) into v_ban from public.penalty_rules;

  for r in select * from public.offense_chain(p_technician) c where c.hold_days > 0 or c.offense_no >= v_ban loop
    select oa.id, oa.status into ex from public.offense_actions oa
     where oa.technician_id = r.technician_id and oa.offense_date = r.offense_date;
    if not found then
      insert into public.offense_actions (technician_id, violation_id, offense_date, offense_no, penalty, hold_days, hold_until)
      values (r.technician_id, r.first_violation_id, r.offense_date, r.offense_no, r.penalty, r.hold_days,
              case when r.hold_days > 0 then r.offense_date + r.hold_days end)
      on conflict (violation_id) do nothing;
    elsif ex.status = 'proposed' then
      update public.offense_actions set offense_no = r.offense_no, penalty = r.penalty, hold_days = r.hold_days,
             hold_until = case when r.hold_days > 0 then r.offense_date + r.hold_days end
       where id = ex.id and (offense_no, penalty, hold_days) is distinct from (r.offense_no, r.penalty, r.hold_days);
    end if;
  end loop;

  -- drop still-undecided proposals that no longer match any restricting offense
  with ch as (select c.technician_id, c.offense_date from public.offense_chain(p_technician) c
               where c.hold_days > 0 or c.offense_no >= v_ban)
  delete from public.offense_actions oa
   where oa.status = 'proposed'
     and (p_technician is null or oa.technician_id = p_technician)
     and not exists (select 1 from ch where ch.technician_id = oa.technician_id and ch.offense_date = oa.offense_date);
end $$;

-- ---------- Keep proposals in sync with violation changes ----------
create or replace function public.trg_violations_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.engine', '1', true);
  delete from public.offense_actions where violation_id = old.id and status = 'proposed';
  return old;   -- decided actions still block deletion (history preserved)
end $$;

create or replace function public.trg_violations_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_offense_actions(old.technician_id);
    return old;
  elsif tg_op = 'UPDATE' then
    if (new.technician_id, new.violation_date, new.severity, new.retraining_required)
       is not distinct from (old.technician_id, old.violation_date, old.severity, old.retraining_required) then
      return new;
    end if;
    perform public.sync_offense_actions(new.technician_id);
    if old.technician_id <> new.technician_id then perform public.sync_offense_actions(old.technician_id); end if;
    return new;
  end if;
  perform public.sync_offense_actions(new.technician_id);
  return new;
end $$;

drop trigger if exists trg_a_before_delete on public.violations;
create trigger trg_a_before_delete before delete on public.violations
  for each row execute function public.trg_violations_before_delete();
drop trigger if exists trg_sync on public.violations;
create trigger trg_sync after insert or update or delete on public.violations
  for each row execute function public.trg_violations_sync();

-- ---------- Callable actions ----------
create or replace function public.recalculate_offenses(p_technician uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin','supervisor','qa']::public.app_role[]) then raise exception 'Not allowed'; end if;
  perform public.sync_offense_actions(p_technician);
end $$;

create or replace function public.lift_ban(p_action uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_tech uuid;
begin
  if not public.has_role(array['admin','supervisor']::public.app_role[]) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to lift a ban'; end if;
  perform set_config('app.engine', '1', true);
  update public.offense_actions
     set lifted_at = now(), lifted_by = auth.uid(), lift_reason = trim(p_reason)
   where id = p_action and status = 'approved' and lifted_at is null
     and offense_no >= (select max(offense_no) from public.penalty_rules)
  returning technician_id into v_tech;
  if v_tech is null then raise exception 'No active approved ban found for this action'; end if;
  perform public.sync_offense_actions(v_tech);
end $$;

-- ---------- Views (security_invoker => RLS applies to the caller) ----------
create or replace view public.v_offense_history with (security_invoker = true) as
select c.technician_id, c.offense_date, c.offense_no, c.severity_group, c.is_major, c.violations_count,
       c.penalty, c.hold_days,
       case when c.hold_days > 0 then c.offense_date + c.hold_days end as hold_until,
       c.chain_start, c.first_violation_id,
       oa.id as action_id, oa.status as approval_status, oa.decided_by, oa.decided_at,
       oa.decision_note, oa.lifted_at, oa.lift_reason
  from public.offense_chain() c
  left join public.offense_actions oa
    on oa.technician_id = c.technician_id and oa.offense_date = c.offense_date;

create or replace view public.v_offense_status with (security_invoker = true) as
with cfg as (
  select coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'monitoring_days'), 30) as days,
         (select max(p.offense_no) from public.penalty_rules p) as ban_no,
         public.ph_today() as today
),
last_c as (
  select distinct on (c.technician_id) c.* from public.offense_chain() c
   order by c.technician_id, c.offense_date desc
),
act as (
  select oa.technician_id,
         bool_or(oa.status = 'approved' and oa.lifted_at is null and oa.offense_no >= cfg.ban_no) as banned,
         max(oa.hold_until) filter (where oa.status = 'approved' and oa.hold_until >= cfg.today) as hold_until,
         count(*) filter (where oa.status = 'proposed') as pending_approvals
    from public.offense_actions oa cross join cfg group by oa.technician_id
),
viol as (
  select v.technician_id, count(*) as total_violations,
         count(*) filter (where v.retraining_required) as counted_violations,
         count(*) filter (where v.status = 'For Retraining'
               and not exists (select 1 from public.retrainings r where r.violation_id = v.id)) as endorsed_pending,
         count(*) filter (where v.retraining_required and v.status <> 'Closed'
               and not exists (select 1 from public.retrainings r where r.violation_id = v.id and r.result = 'Passed')) as retraining_open
    from public.violations v group by v.technician_id
),
base as (
  select t.id as technician_id, trim(t.first_name || ' ' || t.surname) as full_name,
         co.name as company, d.name as designation, t.employment_status,
         lc.offense_date as last_offense_date, lc.offense_no as last_no, lc.penalty as last_penalty,
         coalesce(a.banned, false) as banned, a.hold_until, coalesce(a.pending_approvals, 0) as pending_approvals,
         coalesce(v.total_violations, 0) as total_violations, coalesce(v.counted_violations, 0) as counted_violations,
         coalesce(v.endorsed_pending, 0) as endorsed_retraining_pending, coalesce(v.retraining_open, 0) as retraining_open,
         cfg.days, cfg.ban_no, cfg.today,
         case when coalesce(a.banned, false) then cfg.ban_no
              when lc.offense_date is null then 0
              when lc.offense_date + cfg.days >= cfg.today then lc.last_no_int
              else 0 end as cur_no
    from public.technicians t
    cross join cfg
    left join public.companies co on co.id = t.company_id
    left join public.designations d on d.id = t.designation_id
    left join (select l.*, l.offense_no::int as last_no_int from last_c l) lc on lc.technician_id = t.id
    left join act a on a.technician_id = t.id
    left join viol v on v.technician_id = t.id
)
select b.technician_id, b.full_name, b.company, b.designation, b.employment_status,
       b.last_offense_date,
       b.cur_no as current_offense_no,
       case when b.last_offense_date is not null then b.last_offense_date + b.days end as monitoring_until,
       case when b.banned then 'BANNED'
            when b.last_offense_date is null then 'No offense'
            when b.cur_no > 0 then 'UNDER MONITORING'
            else 'CLEARED' end as monitoring_status,
       case when b.banned then 'BANNED from deployment'
            when b.cur_no > 0 then b.last_penalty end as current_penalty,
       b.hold_until,
       case when b.banned then 'BANNED'
            when b.hold_until is not null then 'ON HOLD until ' || to_char(b.hold_until, 'Mon DD')
            when b.pending_approvals > 0 then 'Restriction pending approval'
            when b.cur_no > 0 then 'Deployable (under monitoring)'
            else 'Deployable' end as deployment_status,
       (not b.banned and b.hold_until is null and b.employment_status not in ('Resigned','Terminated')) as deployment_eligible,
       b.pending_approvals,
       (b.pending_approvals > 0 or (b.cur_no >= 3 and not b.banned) or b.endorsed_retraining_pending > 0) as requires_review,
       nullif(concat_ws('; ',
          case when b.pending_approvals > 0 then 'Restriction awaiting approval' end,
          case when b.cur_no >= 3 and not b.banned then 'Offense #' || b.cur_no || ' under monitoring' end,
          case when b.endorsed_retraining_pending > 0 then 'Retraining not yet recorded' end), '') as review_reason,
       b.endorsed_retraining_pending, b.retraining_open,
       case when b.banned then null else least(b.cur_no + 1, b.ban_no) end as next_offense_no,
       (select p.penalty from public.penalty_rules p
         where not b.banned and p.offense_no = least(b.cur_no + 1, b.ban_no) and p.severity_group = 'Minor') as next_if_minor,
       (select p.penalty from public.penalty_rules p
         where not b.banned and p.offense_no = least(b.cur_no + 1, b.ban_no) and p.severity_group = 'Major') as next_if_major,
       b.total_violations, b.counted_violations
  from base b;

-- ---------- Privileges ----------
revoke all on public.v_offense_history, public.v_offense_status from anon, public;
grant select on public.v_offense_history, public.v_offense_status to authenticated;
grant execute on function public.ph_today(), public.offense_chain(uuid),
                          public.recalculate_offenses(uuid), public.lift_ban(uuid, text) to authenticated;
revoke execute on function public.sync_offense_actions(uuid), public.trg_violations_sync(),
                           public.trg_violations_before_delete() from public, anon, authenticated;
