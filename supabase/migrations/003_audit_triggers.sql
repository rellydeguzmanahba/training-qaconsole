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
