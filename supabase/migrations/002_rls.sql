-- 002_rls.sql | Roles, guards, RLS policies, private evidence storage
-- Run AFTER 001 (before 005). Safe to re-run.

-- Owner (postgres / SECURITY DEFINER functions) bypasses RLS; anon/authenticated never do.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I no force row level security', t);
  end loop;
end $$;

-- ---------- Privileges ----------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
revoke insert, delete on public.profiles from authenticated;           -- accounts come from Auth, not the client
revoke insert, update, delete on public.audit_log from authenticated;  -- append-only, written by triggers
revoke insert, delete on public.offense_actions from authenticated;    -- created by the Phase 4 engine
revoke update on public.offense_actions from authenticated;
grant  update (status, decision_note) on public.offense_actions to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------- Role helpers ----------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where user_id = auth.uid() and active $$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where user_id = auth.uid() and active) $$;

create or replace function public.has_role(r public.app_role[]) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() = any(r), false) $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_role(), public.is_active_user(), public.has_role(public.app_role[]) to authenticated;

-- ---------- Auto-create INACTIVE viewer profile for every new auth user ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name, role, active)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'New user'), 'viewer', false)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Guard: only admins change role/active; never remove the last admin ----------
create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
declare other_admins int;
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.active then
      select count(*) into other_admins from public.profiles where role='admin' and active and user_id <> old.user_id;
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
    select count(*) into other_admins from public.profiles where role='admin' and active and user_id <> old.user_id;
    if other_admins = 0 then raise exception 'Cannot demote or deactivate the last active admin'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard on public.profiles;
create trigger trg_guard before update or delete on public.profiles
  for each row execute function public.guard_profiles();

-- ---------- Guard: supervisor/admin decision on offense actions ----------
create or replace function public.guard_offense_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if old.status <> 'proposed' then raise exception 'This offense action was already decided'; end if;
    if new.status not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_guard on public.offense_actions;
create trigger trg_guard before update on public.offense_actions
  for each row execute function public.guard_offense_action();

-- ---------- Validation: sane dates (Asia/Manila "today") ----------
create or replace function public.validate_dates() returns trigger
language plpgsql set search_path = public as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  if tg_table_name = 'technicians' then
    if new.birthdate is not null and (new.birthdate < date '1900-01-01' or new.birthdate >= today) then raise exception 'Invalid birthdate'; end if;
    if new.date_hired is not null and new.date_hired > today then raise exception 'Date hired cannot be in the future'; end if;
    if new.date_separated is not null and new.date_separated > today then raise exception 'Date separated cannot be in the future'; end if;
  elsif tg_table_name = 'training_records' then
    if new.completed_on > today then raise exception 'Completion date cannot be in the future'; end if;
  elsif tg_table_name = 'violations' then
    if new.violation_date > today then raise exception 'Violation date cannot be in the future'; end if;
  elsif tg_table_name = 'retrainings' then
    if new.result <> 'Pending' and new.retraining_date > today then raise exception 'Completed retraining cannot be dated in the future'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['technicians','training_records','violations','retrainings'] loop
    execute format('drop trigger if exists trg_validate on public.%I', t);
    execute format('create trigger trg_validate before insert or update on public.%I for each row execute function public.validate_dates()', t);
  end loop;
end $$;

-- ---------- Validation: retraining technician must match linked violation ----------
create or replace function public.check_retraining_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.violation_id is not null and not exists
     (select 1 from public.violations v where v.id = new.violation_id and v.technician_id = new.technician_id) then
    raise exception 'Retraining technician does not match the linked violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_link on public.retrainings;
create trigger trg_link before insert or update on public.retrainings
  for each row execute function public.check_retraining_link();

-- ---------- Policies ----------
-- spec: table -> [write roles, delete roles]; everyone active can read.
do $$
declare
  spec jsonb := '{
    "companies":[["admin"],["admin"]], "designations":[["admin"],["admin"]],
    "access_systems":[["admin"],["admin"]], "training_types":[["admin"],["admin"]],
    "violation_categories":[["admin"],["admin"]], "action_types":[["admin"],["admin"]],
    "penalty_rules":[["admin"],["admin"]], "settings":[["admin"],["admin"]],
    "technicians":[["admin","qa","trainer"],["admin"]],
    "technician_access":[["admin","qa","trainer"],["admin","qa","trainer"]],
    "training_records":[["admin","trainer"],["admin"]],
    "violations":[["admin","qa"],["admin"]],
    "violation_category_links":[["admin","qa"],["admin","qa"]],
    "violation_evidence":[["admin","qa"],["admin","qa"]],
    "retrainings":[["admin","trainer"],["admin"]]
  }';
  t text; w text; d text;
begin
  for t in select jsonb_object_keys(spec) loop
    select string_agg(quote_literal(x), ',') into w from jsonb_array_elements_text(spec->t->0) x;
    select string_agg(quote_literal(x), ',') into d from jsonb_array_elements_text(spec->t->1) x;
    execute format('drop policy if exists p_select on public.%I', t);
    execute format('drop policy if exists p_insert on public.%I', t);
    execute format('drop policy if exists p_update on public.%I', t);
    execute format('drop policy if exists p_delete on public.%I', t);
    execute format('create policy p_select on public.%I for select to authenticated using (public.is_active_user())', t);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (public.has_role(array[%s]::public.app_role[]))', t, w);
    execute format('create policy p_update on public.%I for update to authenticated using (public.has_role(array[%s]::public.app_role[])) with check (public.has_role(array[%s]::public.app_role[]))', t, w, w);
    execute format('create policy p_delete on public.%I for delete to authenticated using (public.has_role(array[%s]::public.app_role[]))', t, d);
  end loop;
end $$;

-- profiles: see own row (even if inactive) or, when active, all; update own name or (admin) anyone
drop policy if exists p_select on public.profiles;
drop policy if exists p_update on public.profiles;
create policy p_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_active_user());
create policy p_update on public.profiles for update to authenticated
  using (user_id = auth.uid() or public.has_role(array['admin']::public.app_role[]))
  with check (user_id = auth.uid() or public.has_role(array['admin']::public.app_role[]));

-- offense_actions: read all active; supervisor/admin may decide (guard + column grants limit what changes)
drop policy if exists p_select on public.offense_actions;
drop policy if exists p_update on public.offense_actions;
create policy p_select on public.offense_actions for select to authenticated using (public.is_active_user());
create policy p_update on public.offense_actions for update to authenticated
  using (public.has_role(array['admin','supervisor']::public.app_role[]))
  with check (public.has_role(array['admin','supervisor']::public.app_role[]));

-- audit_log: read-only for admin, qa, supervisor
drop policy if exists p_select on public.audit_log;
create policy p_select on public.audit_log for select to authenticated
  using (public.has_role(array['admin','qa','supervisor']::public.app_role[]));

-- import tables: admin only
do $$ declare t text; begin
  foreach t in array array['import_batches','import_errors'] loop
    execute format('drop policy if exists p_admin on public.%I', t);
    execute format('create policy p_admin on public.%I for all to authenticated using (public.has_role(array[''admin'']::public.app_role[])) with check (public.has_role(array[''admin'']::public.app_role[]))', t);
  end loop;
end $$;

-- ---------- Private evidence bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists evidence_read   on storage.objects;
drop policy if exists evidence_insert on storage.objects;
drop policy if exists evidence_update on storage.objects;
drop policy if exists evidence_delete on storage.objects;
create policy evidence_read   on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.is_active_user());
create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.has_role(array['admin','qa']::public.app_role[]));
create policy evidence_update on storage.objects for update to authenticated
  using (bucket_id = 'evidence' and public.has_role(array['admin','qa']::public.app_role[]))
  with check (bucket_id = 'evidence' and public.has_role(array['admin','qa']::public.app_role[]));
create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and public.has_role(array['admin','qa']::public.app_role[]));

-- ---------- ONE-TIME BOOTSTRAP (run manually after creating your first user in Auth) ----------
-- update public.profiles set role = 'admin', active = true
--  where user_id = (select id from auth.users where email = 'YOUR_EMAIL');
