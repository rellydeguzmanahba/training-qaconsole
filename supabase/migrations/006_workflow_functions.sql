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
