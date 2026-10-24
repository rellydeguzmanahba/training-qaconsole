-- setup_all.sql | 001 -> 002 -> 005 -> 003 -> 004 -> 006 -> 007 in one paste. The individual files remain the source of truth.

-- ====================== 001_schema.sql ======================
-- 001_schema.sql | AHBA QA & Training Management System
-- Run order: 001 -> 005 (RLS policies come in 002; RLS is enabled here = deny-all until then)

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type public.app_role          as enum ('admin','qa','trainer','supervisor','viewer');
create type public.employment_status as enum ('Applicant','Probationary','Regular','Resigned','Terminated');
create type public.severity_level    as enum ('Minor','Major','Critical');
create type public.severity_group    as enum ('Minor','Major');           -- Critical uses Major rules
create type public.violation_status  as enum ('Open','For Retraining','Closed');
create type public.retraining_result as enum ('Pending','Passed','Failed');
create type public.approval_status   as enum ('proposed','approved','rejected');

-- ---------- Shared trigger: updated_at + optimistic-lock version ----------
create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.version    := coalesce(old.version, 0) + 1;
  return new;
end $$;

-- ---------- Users / roles ----------
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null check (length(trim(full_name)) > 0),
  role       public.app_role not null default 'viewer',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    int not null default 1
);

-- ---------- Lookups ----------
create table public.companies (
  id serial primary key,
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create unique index companies_name_uq on public.companies (lower(trim(name)));

create table public.designations (
  id serial primary key,
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create unique index designations_name_uq on public.designations (lower(trim(name)));

create table public.access_systems (
  id serial primary key,
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create unique index access_systems_name_uq on public.access_systems (lower(trim(name)));

create table public.training_types (
  id serial primary key,
  name text not null check (length(trim(name)) > 0),
  required boolean not null default true,       -- counts toward completion % / missing-training detection
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create unique index training_types_name_uq on public.training_types (lower(trim(name)));

create table public.violation_categories (
  id serial primary key,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  unique (code, name)                            -- workbook has code C2-EV twice with different names
);

create table public.action_types (
  id serial primary key,
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true
);
create unique index action_types_name_uq on public.action_types (lower(trim(name)));

create table public.penalty_rules (
  offense_no     smallint not null check (offense_no between 1 and 5),
  severity_group public.severity_group not null,
  penalty        text not null,
  hold_days      int  not null default 0 check (hold_days >= 0),
  updated_at     timestamptz not null default now(),
  version        int not null default 1,
  primary key (offense_no, severity_group)
);

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  version     int not null default 1
);

-- ---------- Technicians ----------
create table public.technicians (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null check (length(trim(first_name)) > 0),
  middle_name   text,
  surname       text not null check (length(trim(surname)) > 0),
  -- duplicate-prevention key: first name + surname, case/space-insensitive (same key the workbook uses)
  name_key      text generated always as (lower(regexp_replace(trim(first_name || ' ' || surname), '\s+', ' ', 'g'))) stored,
  birthdate     date,
  date_hired    date,
  company_id    int references public.companies(id),
  designation_id int references public.designations(id),
  mobile        text check (mobile is null or mobile ~ '^[0-9+][0-9 -]{6,19}$'),
  email         text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  employment_status public.employment_status not null default 'Regular',
  date_separated date,
  separation_reason text,
  lms_user      text,
  lms_login     text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  check (date_separated is null or date_hired is null or date_separated >= date_hired)
);
create unique index technicians_name_key_uq on public.technicians (name_key);
create index technicians_company_idx     on public.technicians (company_id);
create index technicians_status_idx      on public.technicians (employment_status);

create table public.technician_access (
  technician_id uuid not null references public.technicians(id) on delete cascade,
  access_id     int  not null references public.access_systems(id),
  primary key (technician_id, access_id)
);

-- ---------- Training ----------
create table public.training_records (
  id               uuid primary key default gen_random_uuid(),
  technician_id    uuid not null references public.technicians(id),
  training_type_id int  not null references public.training_types(id),
  completed_on     date not null,
  trainer          text,
  remarks          text,
  client_request_id uuid unique,                -- idempotency key against double submit
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (technician_id, training_type_id, completed_on)
);
create index training_records_tech_idx on public.training_records (technician_id, training_type_id);

-- ---------- QA violations ----------
create table public.violations (
  id              uuid primary key default gen_random_uuid(),
  technician_id   uuid not null references public.technicians(id),
  violation_date  date not null,
  description     text not null check (length(trim(description)) > 0),
  severity        public.severity_level not null default 'Minor',
  reported_by     text,                           -- free text from workbook
  reported_by_user uuid references auth.users(id),
  action_taken_id int references public.action_types(id),
  retraining_required boolean not null default true,   -- counts as an offense when true
  status          public.violation_status not null default 'Open',
  corrective_action text,
  remarks         text,
  recommendation  text,
  ibas_no         text,
  jo_number       text,
  client_request_id uuid unique,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int not null default 1
);
create index violations_tech_date_idx on public.violations (technician_id, violation_date);
create index violations_status_idx    on public.violations (status);

create table public.violation_category_links (
  violation_id uuid not null references public.violations(id) on delete cascade,
  category_id  int  not null references public.violation_categories(id),
  primary key (violation_id, category_id)
);

create table public.violation_evidence (
  id           uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public.violations(id) on delete cascade,
  storage_path text,                              -- private bucket 'evidence'
  external_url text,                              -- e.g. legacy Google Drive link
  file_name    text,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  check (num_nonnulls(storage_path, external_url) = 1),
  check (external_url is null or external_url ~* '^https://')
);
create index violation_evidence_v_idx on public.violation_evidence (violation_id);

-- ---------- Retraining ----------
create table public.retrainings (
  id               uuid primary key default gen_random_uuid(),
  violation_id     uuid references public.violations(id),   -- null = manual retraining (no offense effect)
  technician_id    uuid not null references public.technicians(id),
  training_type_id int  not null references public.training_types(id),
  retraining_date  date,
  trainer          text,
  result           public.retraining_result not null default 'Pending',
  remarks          text,
  manual_reason    text,
  client_request_id uuid unique,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  check (violation_id is not null or manual_reason is not null),
  check (result = 'Pending' or retraining_date is not null)
);
create index retrainings_tech_idx on public.retrainings (technician_id);
create index retrainings_viol_idx on public.retrainings (violation_id);

-- ---------- Offense approvals (rows created by the Phase 4 engine) ----------
create table public.offense_actions (
  id            uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.technicians(id),
  violation_id  uuid not null references public.violations(id),
  offense_no    smallint not null check (offense_no between 1 and 5),
  penalty       text not null,
  hold_days     int not null default 0,
  hold_until    date,
  status        public.approval_status not null default 'proposed',
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  unique (violation_id),
  check (status = 'proposed' or (decided_by is not null and decided_at is not null))
);
create index offense_actions_tech_idx on public.offense_actions (technician_id, status);

-- ---------- Audit + import ----------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  text,
  action     text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data   jsonb,
  new_data   jsonb,
  actor      uuid,
  at         timestamptz not null default now()
);
create index audit_log_table_rec_idx on public.audit_log (table_name, record_id);
create index audit_log_at_idx        on public.audit_log (at desc);

create table public.import_batches (
  id         uuid primary key default gen_random_uuid(),
  file_name  text not null,
  status     text not null default 'previewed' check (status in ('previewed','committed','failed','cancelled')),
  summary    jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table public.import_errors (
  id        bigint generated always as identity primary key,
  batch_id  uuid not null references public.import_batches(id) on delete cascade,
  sheet     text not null,
  row_no    int,
  field     text,
  severity  text not null default 'error' check (severity in ('error','warning')),
  message   text not null
);

-- ---------- Version/updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','companies','designations','access_systems','training_types',
    'violation_categories','penalty_rules','settings','technicians','training_records','violations',
    'retrainings','offense_actions']
  loop
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_row()', t);
  end loop;
end $$;

-- ---------- RLS on every table (deny-all for API roles until 002_rls.sql adds policies) ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ====================== 002_rls.sql ======================
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

-- ====================== 005_seed_lookups.sql ======================
-- 005_seed_lookups.sql  |  Lookup data extracted from AHBA workbook (no technician/violation data)
-- Idempotent: safe to re-run.

insert into public.companies(name) values
  ('AHBA'),
  ('MSA - Aveline'),
  ('MSA - J2'),
  ('MSA - Allys88'),
  ('MSA - Ria Tech')
on conflict (name) do nothing;

-- Last 3 designations are used by technicians in the workbook but missing from its dropdown list.
insert into public.designations(name) values
  ('Admin'),
  ('Dispatcher'),
  ('Driver Technician'),
  ('Head Admin'),
  ('Manager'),
  ('Motorized'),
  ('Owner'),
  ('QA Inspector'),
  ('Supervisor'),
  ('Technician'),
  ('TDO - Technical QA'),
  ('OPERATIONS MANAGER'),
  ('WAREHOUSE')
on conflict (name) do nothing;

insert into public.access_systems(name) values
  ('Account Lookup'),
  ('Back Tool'),
  ('Jo Mobile'),
  ('Jo Web'),
  ('Salesforce'),
  ('WFM')
on conflict (name) do nothing;

insert into public.training_types(name, sort_order) values
  ('SLI Standard', 10),
  ('SLR Standard', 20),
  ('Salesforce', 30),
  ('WFM', 40),
  ('Field Ops Apps', 50),
  ('Nap Augmentation', 60),
  ('Nap Audit', 70),
  ('QA Standard', 80),
  ('Safety Training', 90),
  ('Refresher', 100),
  ('Sell All', 110),
  ('Jo Mobile', 120),
  ('Port Tagging', 130)
on conflict (name) do nothing;

insert into public.action_types(name) values
  ('For Rectification'),
  ('For Penalty')
on conflict (name) do nothing;

-- Note: code C2-EV appears twice in the workbook with different names, so uniqueness is (code, name).
insert into public.violation_categories(code, name) values
  ('NS-01', 'Agent Poaching'),
  ('NS-02', 'Sales Takeover'),
  ('NS-03', 'Fraudulent Sales Acquisition'),
  ('GN-01', 'Ethics / Policy Violation'),
  ('CA-01', 'Improper Account Handling'),
  ('CA-02', 'Product Switching / Churn Inducement'),
  ('CA-03', 'Revolving Churn'),
  ('AST-03', 'Repeated Policy Violations'),
  ('AST-04', 'SLA Miss on Backbone Outages'),
  ('BDM-02', 'Data Privacy'),
  ('BDM-05', 'Data Leak / Hacking Incident'),
  ('BDM-09', 'Regulatory – ASC (CDO Violation / Posting of Banned Material)'),
  ('BDM-10', 'Regulatory – ASC (Falsification of Documents / Certifications)'),
  ('BDM-11', 'Regulatory – ASC (Breach of Confidentiality)'),
  ('INV-01', 'Theft, Pilferage, Fraud (3PP Fault)'),
  ('NI-03', 'Unauthorized Installation Takeover'),
  ('NI-04', 'Job Order Picking'),
  ('NI-05', 'Incorrect installation – wrong customer'),
  ('MIS004', 'Forging Signature'),
  ('FN001', 'Extortion / Illegal Solicitation'),
  ('FN002', 'Tech-Sales Collusion'),
  ('FN003', 'Theft'),
  ('FN004', 'Bogus Subscriber'),
  ('FN011', 'Illegal Pullout'),
  ('OT-01', 'Employee Poaching'),
  ('AM-01', 'Credential Misuse'),
  ('FN012', 'Selling Converge Materials'),
  ('C1-EV', 'Persistent Violation (Moderate-Risk )'),
  ('FN013', 'Unauthorized JO Installation'),
  ('FRD-02', 'Falsified Rectification Report'),
  ('FRD-03', 'False Declarations/R eports'),
  ('NI-06', 'Installation in Non-RFS Areas'),
  ('NI-07', 'Area Exclusivity'),
  ('C2-EV', 'Hiring of Blacklisted Personnel'),
  ('C2-EV', 'Persistent Violation (Low-risk)'),
  ('NC003', 'Unauthorized Change Activity'),
  ('MD001', 'Falsified Report'),
  ('FD001', 'Unutilized NAP Installation'),
  ('TSU-CO L-004', 'Cash Shortages and Overages'),
  ('TSU-CO L-005', 'Unauthorized Offsetting of Cash Collections'),
  ('TSU-CO L-006', 'Falsification of deposit slips or proof of payments'),
  ('TSU-CO L-007', 'Non-remittance of SLI collections'),
  ('MIS008', 'TIKAL (Pitas/ Putol)'),
  ('AST-01', 'Minor Manual Dispatch Override'),
  ('AST-02', 'Excessive Manual Dispatch Override'),
  ('BDM-01', 'Branding Guidelines Violation'),
  ('BDM-03', 'Digital Posting Violation'),
  ('BDM-04', 'Customer Engagement Violation'),
  ('BDM-06', 'Regulatory (NTC & DTI)'),
  ('BDM-07', 'Regulatory – ASC (Pre-Screening Violation)'),
  ('BDM-08', 'Regulatory – ASC (Non-Submissi on of CDO Report)'),
  ('BDM-12', 'Regulatory – ASC (Cancellation of Scheduled Hearing/Scree ning)'),
  ('BDM-13', 'Non-Complianc e with Policy and Procedures'),
  ('BDM-14', 'Habitual Disregard of Compliance Initiatives'),
  ('INV-02', 'Loss Despite Preventive Measures'),
  ('INV-03', 'Unresolved Inventory Variance'),
  ('INV-04', 'Damages Due to Mishandling'),
  ('NI-01', 'SLI Delay in JO Closure'),
  ('PR001', 'Sagging Drop Wire'),
  ('PR002', 'Drop Wire on Power/Telco'),
  ('PR003', 'Missing S-Clamp on Pole'),
  ('PR004', 'Spliced Fiber Drop Wire'),
  ('PR005', 'Poor Routing on NAP'),
  ('PR006', 'Fiber drop on Substandard Pole'),
  ('PR007', 'Fiber drop on Private Property w/o Waiver'),
  ('PR008', 'NAP Left Open(Last touch)'),
  ('PR009', 'Missing Mid-span Clamp'),
  ('PR010', 'Unreported Damaged NAP'),
  ('PR011', 'Wrong Port Assignment'),
  ('PR012', 'Improper Pole Attach'),
  ('PR013', 'No Label at NAP'),
  ('INW001', 'Substandard Indoor Cabling'),
  ('INW002', 'Poor NIU / No Patch Cord'),
  ('INW003', 'Missing Label in NIU Box'),
  ('INW004', 'Incomplete Materials'),
  ('HA001', 'No or Poor Bracket'),
  ('HA002', 'No S-Clamp on Bracket'),
  ('CPE001', 'Failed Signal Level'),
  ('CPE002', 'Missing Modem Screenshot'),
  ('CPE003', 'Wrong Declared SN/MAC'),
  ('CPE004', 'Wrong Type CPE Installed'),
  ('CS006', 'Back Job - No Internet'),
  ('CS007', 'Back Job - SLA Miss'),
  ('CS008', 'High Plan Delay'),
  ('CS009', 'Wrong JO Closure'),
  ('MIS001', 'False Reschedule'),
  ('MIS002', 'OVS Clearance Issues'),
  ('MIS003', 'Wrong Material Declaration'),
  ('MIS005', 'Wrong Install Address'),
  ('MIS006', 'Misdeclared Defective CPE'),
  ('MIS007', 'Failed Business Validation'),
  ('MIS009', 'Unreported NAP Changes'),
  ('MIS010', 'False Active Declaration'),
  ('FN005', 'Wrong Address Install'),
  ('FN006', 'Lost Modems/Materi als'),
  ('FN007', 'Property Damage'),
  ('FN008', 'Same Address Duplicate Install'),
  ('FN009', 'Change to S2S/Bida Fiber'),
  ('FN010', 'Wrong Subscriber'),
  ('MIS011', 'Unauthorized Installation Practices'),
  ('INS-03', 'Damage to NAP'),
  ('PR014', 'Port Allocation / Installation for Pending or Unapproved Applications'),
  ('PR015', 'Port & NAP Installation for Non-RFS Areas'),
  ('PR016', 'NAP & Port Assignment Inaccuracy'),
  ('PR017', 'Unauthorized NAP Augmentation'),
  ('PR018', 'Negligence in NAP Maintenance'),
  ('PR019', 'Uncoordinated NAP Activity'),
  ('NS-05', 'Sales Turn-in Already Engaged by Other Brand Partners'),
  ('PR020', 'Failure to secure approval'),
  ('PR021', 'Failure to report any NAP damage'),
  ('NI-02', 'SLR Delay in JO Closure'),
  ('NC001', 'Late / Missing IM Checklist Submission'),
  ('MD002', 'Inventory Record Discrepancy'),
  ('IM002', 'Incorrect Equipment Tagging'),
  ('TSU-CO L-002', 'Double posting of payment in the JO Mobile'),
  ('TSU-CO L-001', 'Unposted Payments'),
  ('TSU-CO L-003', 'Incorrect Filling Out of Manual Receipts'),
  ('TSU-CO L-008', 'Late deposit of collections'),
  ('SF002', 'Unauthorized repair conducted without a Salesforce ticket.'),
  ('AS001', 'Modification without corresponding Job Order and charges'),
  ('AS002', 'Waiver of Penalties or Charges Without Approval'),
  ('STY001', 'No PPE / Unsafe Setup'),
  ('STY002', 'Ladder Setup Violation'),
  ('STY003', 'Unmanned Vehicle'),
  ('CS001', 'Ungroomed / Improper Attire'),
  ('CS002', 'Disrespectful behavior'),
  ('CS003', 'Lack of Tools'),
  ('CS004', 'Non-Compliant Vehicle'),
  ('CS005', 'Dropping Calls'),
  ('DOC001', 'Incomplete SAR'),
  ('DOC002', 'Incomplete Documentation'),
  ('NS-04', 'Territorial Restrictions'),
  ('DOC003', 'No uploaded SAR/SR in the system'),
  ('DOC004', 'No signature on the SAR/SR uploaded in the system'),
  ('DOC005', 'Inaccurate or missing material usage in the system')
on conflict (code, name) do nothing;

insert into public.penalty_rules(offense_no, severity_group, penalty, hold_days) values
  (1, 'Minor', 'Written Warning', 0),
  (1, 'Major', 'Retraining', 0),
  (2, 'Minor', 'Retraining', 0),
  (2, 'Major', 'Retraining', 0),
  (3, 'Minor', 'Retraining + Hold deployment (1 day)', 1),
  (3, 'Major', 'Retraining + Hold deployment (2–3 days)', 3),
  (4, 'Minor', 'Hold deployment 1 week – Re-accreditation exam', 7),
  (4, 'Major', 'Hold deployment 1 week – Re-accreditation exam', 7),
  (5, 'Minor', 'BANNED from deployment', 0),
  (5, 'Major', 'BANNED from deployment', 0)
on conflict (offense_no, severity_group) do nothing;

insert into public.settings(key, value, description) values
  ('monitoring_days', '30'::jsonb, 'Days after last counted violation before an offense record clears')
on conflict (key) do nothing;

-- ====================== 003_audit_triggers.sql ======================
-- 003_audit_triggers.sql | Append-only audit trail (stores only changed fields on UPDATE)
-- Run AFTER 002 (and after 005 to avoid logging seed rows).

alter table public.audit_log add column if not exists technician_id uuid;
create index if not exists audit_log_tech_idx on public.audit_log (technician_id, at desc);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; src jsonb; rid text; tid uuid; vid uuid;
  d_old jsonb := '{}'; d_new jsonb := '{}'; k text;
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then n := to_jsonb(new); end if;
  src := coalesce(n, o);

  select string_agg(coalesce(src->>c, ''), '/') into rid
    from unnest(string_to_array(tg_argv[0], ',')) c;

  if tg_table_name = 'technicians' then
    tid := (src->>'id')::uuid;
  elsif src ? 'technician_id' then
    tid := (src->>'technician_id')::uuid;
  elsif src ? 'violation_id' then
    vid := (src->>'violation_id')::uuid;
    select technician_id into tid from public.violations where id = vid;
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('version','updated_at') and (n->k) is distinct from (o->k) then
        d_old := d_old || jsonb_build_object(k, o->k);
        d_new := d_new || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if d_new = '{}'::jsonb then return null; end if;   -- nothing meaningful changed
    o := d_old; n := d_new;
  end if;

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, actor, technician_id)
  values (tg_table_name, rid, tg_op, o, n, auth.uid(), tid);
  return null;
end $$;

-- Audit log is immutable for everyone (maintenance requires disabling this trigger as owner)
create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$ begin raise exception 'audit_log is append-only'; end $$;
drop trigger if exists trg_immutable on public.audit_log;
create trigger trg_immutable before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Attach to all business tables: table -> key columns
do $$
declare
  spec jsonb := '{
    "profiles":"user_id", "companies":"id", "designations":"id", "access_systems":"id",
    "training_types":"id", "violation_categories":"id", "action_types":"id",
    "penalty_rules":"offense_no,severity_group", "settings":"key",
    "technicians":"id", "technician_access":"technician_id,access_id",
    "training_records":"id", "violations":"id",
    "violation_category_links":"violation_id,category_id", "violation_evidence":"id",
    "retrainings":"id", "offense_actions":"id", "import_batches":"id"
  }';
  t text;
begin
  for t in select jsonb_object_keys(spec) loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row(%L)', t, spec->>t);
  end loop;
end $$;

-- ====================== 004_offense_engine.sql ======================
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

-- ====================== 006_workflow_functions.sql ======================
-- 006_workflow_functions.sql | Atomic save functions for violations and retraining
-- Run after 004. Safe to re-run.
-- create_violation / update_violation are SECURITY INVOKER: RLS still decides who may write (admin, qa).
-- save_retraining is SECURITY DEFINER (trainers may not edit violations directly) with an explicit role check.
--
-- RULE ASSUMED: for violations with retraining_required = true,
--   a Pending retraining moves an Open violation to 'For Retraining';
--   a Passed retraining closes it. A Failed retraining changes nothing (assign another one).
--   Re-opening a closed violation is a manual QA edit.

create or replace function public.create_violation(p jsonb, p_categories int[]) returns uuid
language plpgsql set search_path = public as $$
declare v_id uuid; v_req uuid := nullif(p->>'client_request_id', '')::uuid;
begin
  if coalesce(array_length(p_categories, 1), 0) = 0 then raise exception 'Select at least one violation category'; end if;
  insert into public.violations (technician_id, violation_date, description, severity, reported_by, reported_by_user,
      action_taken_id, retraining_required, status, corrective_action, remarks, recommendation, ibas_no, jo_number,
      client_request_id, created_by)
  values ((p->>'technician_id')::uuid, (p->>'violation_date')::date, p->>'description', (p->>'severity')::public.severity_level,
      nullif(p->>'reported_by', ''), auth.uid(), nullif(p->>'action_taken_id', '')::int,
      coalesce((p->>'retraining_required')::boolean, true), coalesce(nullif(p->>'status', ''), 'Open')::public.violation_status,
      nullif(p->>'corrective_action', ''), nullif(p->>'remarks', ''), nullif(p->>'recommendation', ''),
      nullif(p->>'ibas_no', ''), nullif(p->>'jo_number', ''), v_req, auth.uid())
  on conflict (client_request_id) do nothing
  returning id into v_id;
  if v_id is null then                      -- same request submitted twice: reuse the first result
    select id into v_id from public.violations where client_request_id = v_req;
    if v_id is null then raise exception 'Could not save the violation'; end if;
  end if;
  insert into public.violation_category_links (violation_id, category_id)
  select v_id, c from unnest(p_categories) c on conflict do nothing;
  return v_id;
end $$;

create or replace function public.update_violation(p_id uuid, p_version int, p jsonb, p_categories int[]) returns void
language plpgsql set search_path = public as $$
declare n int;
begin
  if coalesce(array_length(p_categories, 1), 0) = 0 then raise exception 'Select at least one violation category'; end if;
  update public.violations set
    technician_id = (p->>'technician_id')::uuid, violation_date = (p->>'violation_date')::date,
    description = p->>'description', severity = (p->>'severity')::public.severity_level,
    reported_by = nullif(p->>'reported_by', ''), action_taken_id = nullif(p->>'action_taken_id', '')::int,
    retraining_required = (p->>'retraining_required')::boolean, status = (p->>'status')::public.violation_status,
    corrective_action = nullif(p->>'corrective_action', ''), remarks = nullif(p->>'remarks', ''),
    recommendation = nullif(p->>'recommendation', ''), ibas_no = nullif(p->>'ibas_no', ''), jo_number = nullif(p->>'jo_number', '')
  where id = p_id and version = p_version;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'This record was changed by someone else (or you no longer have permission). Reload and try again.'; end if;
  delete from public.violation_category_links where violation_id = p_id and category_id <> all (p_categories);
  insert into public.violation_category_links (violation_id, category_id)
  select p_id, c from unnest(p_categories) c on conflict do nothing;
end $$;

create or replace function public.save_retraining(p_id uuid, p_version int, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_viol uuid; v_tech uuid; v_vstatus public.violation_status; v_req boolean;
  v_res public.retraining_result := coalesce(nullif(p->>'result', ''), 'Pending')::public.retraining_result;
  v_key uuid := nullif(p->>'client_request_id', '')::uuid;
begin
  if not public.has_role(array['admin', 'trainer']::public.app_role[]) then
    raise exception 'You do not have permission to manage retraining';
  end if;

  if p_id is null then
    v_viol := nullif(p->>'violation_id', '')::uuid;
    if v_viol is not null then
      select technician_id into v_tech from public.violations where id = v_viol;
      if v_tech is null then raise exception 'Violation not found'; end if;
    else
      v_tech := nullif(p->>'technician_id', '')::uuid;
      if v_tech is null then raise exception 'Select a technician'; end if;
    end if;
    insert into public.retrainings (violation_id, technician_id, training_type_id, retraining_date, trainer, result,
        remarks, manual_reason, client_request_id, created_by)
    values (v_viol, v_tech, (p->>'training_type_id')::int, nullif(p->>'retraining_date', '')::date,
        nullif(p->>'trainer', ''), v_res, nullif(p->>'remarks', ''), nullif(p->>'manual_reason', ''), v_key, auth.uid())
    on conflict (client_request_id) do nothing
    returning id into v_id;
    if v_id is null then                    -- duplicate submit: already saved, nothing more to do
      select id into v_id from public.retrainings where client_request_id = v_key;
      return v_id;
    end if;
  else
    update public.retrainings set training_type_id = (p->>'training_type_id')::int,
        retraining_date = nullif(p->>'retraining_date', '')::date, trainer = nullif(p->>'trainer', ''),
        result = v_res, remarks = nullif(p->>'remarks', '')
     where id = p_id and version = p_version
    returning id, violation_id into v_id, v_viol;
    if v_id is null then raise exception 'This record was changed by someone else. Reload and try again.'; end if;
  end if;

  if v_viol is not null then                -- keep the linked violation's status in step
    select status, retraining_required into v_vstatus, v_req from public.violations where id = v_viol;
    if v_req then
      if v_res = 'Pending' and v_vstatus = 'Open' then
        update public.violations set status = 'For Retraining' where id = v_viol;
      elsif v_res = 'Passed' and v_vstatus in ('Open', 'For Retraining') then
        update public.violations set status = 'Closed' where id = v_viol;
      end if;
    end if;
  end if;
  return v_id;
end $$;

revoke execute on function public.create_violation(jsonb, int[]), public.update_violation(uuid, int, jsonb, int[]),
                           public.save_retraining(uuid, int, jsonb) from public, anon;
grant execute on function public.create_violation(jsonb, int[]), public.update_violation(uuid, int, jsonb, int[]),
                          public.save_retraining(uuid, int, jsonb) to authenticated;

-- ====================== 007_indexes.sql ======================
-- 007_indexes.sql | Supporting indexes for list/report/dashboard queries. Safe to re-run.
create index if not exists violations_date_idx          on public.violations (violation_date desc);
create index if not exists violations_created_idx       on public.violations (created_at desc);
create index if not exists violations_action_idx        on public.violations (action_taken_id);
create index if not exists training_records_date_idx    on public.training_records (completed_on desc);
create index if not exists training_records_created_idx on public.training_records (created_at desc);
create index if not exists training_records_type_idx    on public.training_records (training_type_id);
create index if not exists retrainings_created_idx      on public.retrainings (created_at desc);
create index if not exists retrainings_result_idx       on public.retrainings (result);
create index if not exists retrainings_type_idx         on public.retrainings (training_type_id);
create index if not exists violation_links_cat_idx      on public.violation_category_links (category_id);
create index if not exists technician_access_sys_idx    on public.technician_access (access_id);
create index if not exists technicians_designation_idx  on public.technicians (designation_id);
analyze;
