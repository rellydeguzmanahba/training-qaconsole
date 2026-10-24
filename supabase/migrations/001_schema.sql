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
