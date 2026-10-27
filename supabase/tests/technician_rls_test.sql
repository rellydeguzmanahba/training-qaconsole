-- technician_rls_test.sql | Run AFTER 010a + 010b. Everything is created inside a transaction and ROLLED BACK.
-- A failing check stops the script with a message naming the check. On success the last result row says ALL PASSED.
-- It creates temporary fake auth users / technicians only inside the transaction; no real data is read or changed.
begin;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform pg_temp.as_owner();
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create or replace function pg_temp.must(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'TEST FAILED: %', p_msg; end if; end $$;

do $$
declare
  uadm uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); uunv uuid := gen_random_uuid();
  ta uuid; tb uuid; va uuid; vb uuid; n int; failed boolean;
begin
  -- fixtures (as owner)
  insert into auth.users (id, email, email_confirmed_at) values
    (uadm, 'zz-admin@test.invalid', now()), (ua, 'zz-a@test.invalid', now()), (ub, 'zz-b@test.invalid', now()),
    (uv, 'zz-viewer@test.invalid', now()), (uunv, 'zz-unverified@test.invalid', null);
  update public.profiles set role = 'admin', active = true where user_id = uadm;
  update public.profiles set role = 'viewer', active = true where user_id = uv;
  insert into public.technicians (first_name, surname, employment_status) values ('ZZTest', 'Alpha', 'Regular') returning id into ta;
  insert into public.technicians (first_name, surname, employment_status) values ('ZZTest', 'Bravo', 'Regular') returning id into tb;
  insert into public.violations (technician_id, violation_date, description, severity) values (ta, current_date - 3, 'zz alpha finding', 'Minor') returning id into va;
  insert into public.violations (technician_id, violation_date, description, severity) values (tb, current_date - 2, 'zz bravo finding', 'Major') returning id into vb;
  insert into public.violation_evidence (violation_id, storage_path, file_name, visible_to_technician) values
    (va, 'zz/alpha-shared.pdf', 'shared.pdf', true), (va, 'zz/alpha-hidden.pdf', 'hidden.pdf', false), (vb, 'zz/bravo-shared.pdf', 'b.pdf', true);

  -- 1. provisioning (admin only, explicit ids, one-to-one)
  perform pg_temp.as_user(uadm);
  perform public.link_technician_account(ua, ta);
  perform public.link_technician_account(ub, tb);
  failed := false; begin perform public.link_technician_account(ua, tb); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'one account must not link to a second technician');
  failed := false; begin perform public.link_technician_account(uv, ta); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'one technician must not get a second account');
  failed := false; begin perform public.link_technician_account(uunv, tb); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'unverified email must not be linkable');
  failed := false; begin perform public.link_technician_account(uadm, tb); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'a staff (admin) account must not be linkable');
  perform pg_temp.must((select count(*) from public.admin_list_accounts()) >= 5, 'admin can list accounts');
  perform pg_temp.as_owner();

  -- 2. technician A: denied on every base table, sees only own portal data
  perform pg_temp.as_user(ua);
  perform pg_temp.must((select count(*) from public.technicians) = 0, 'A must not read technicians');
  perform pg_temp.must((select count(*) from public.violations) = 0, 'A must not read violations');
  perform pg_temp.must((select count(*) from public.violation_evidence) = 0, 'A must not read evidence rows');
  perform pg_temp.must((select count(*) from public.training_records) = 0, 'A must not read training records');
  perform pg_temp.must((select count(*) from public.retrainings) = 0, 'A must not read retrainings');
  perform pg_temp.must((select count(*) from public.offense_actions) = 0, 'A must not read offense actions');
  perform pg_temp.must((select count(*) from public.audit_log) = 0, 'A must not read the audit log');
  perform pg_temp.must((select count(*) from public.settings) = 0, 'A must not read settings');
  perform pg_temp.must((select count(*) from public.v_offense_status) = 0, 'A must not read the staff offense view');
  perform pg_temp.must((select count(*) from public.technician_accounts) = 0, 'A must not read account links');
  perform pg_temp.must((select count(*) from public.profiles) = 1, 'A sees only the own profile');
  perform pg_temp.must((select surname from public.v_my_profile) = 'Alpha', 'A portal profile is Alpha');
  perform pg_temp.must((select count(*) from public.v_my_violations) = 1, 'A sees exactly the own violation');
  perform pg_temp.must((select description from public.v_my_violations) = 'zz alpha finding', 'A sees own violation text');
  perform pg_temp.must((select count(*) from public.v_my_evidence) = 1, 'A sees only shared evidence');
  perform pg_temp.must(public.technician_can_read_object('zz/alpha-shared.pdf'), 'A may open shared evidence');
  perform pg_temp.must(not public.technician_can_read_object('zz/alpha-hidden.pdf'), 'A must not open unshared evidence');
  perform pg_temp.must(not public.technician_can_read_object('zz/bravo-shared.pdf'), 'A must not open B evidence');
  perform pg_temp.must((select count(*) from public.my_monitoring()) = 1, 'A monitoring returns one row');
  perform pg_temp.must((select count(*) from public.my_penalties()) >= 1, 'A penalties come from the engine');
  failed := false; begin perform * from public.admin_list_accounts(); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'A must not list accounts');
  failed := false; begin perform public.link_technician_account(ua, tb); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'A must not link accounts');
  failed := false; begin perform public.recalculate_offenses(null); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'A must not run recalculation');
  failed := false; begin insert into public.violations (technician_id, violation_date, description, severity) values (ta, current_date, 'x', 'Minor'); exception when others then failed := true; end;
  perform pg_temp.must(failed, 'A must not insert violations');
  update public.technicians set mobile = '09000000000' where id = ta; get diagnostics n = row_count;
  perform pg_temp.must(n = 0, 'A must not update technicians');
  failed := false; begin update public.profiles set role = 'admin' where user_id = ua; exception when others then failed := true; end;
  perform pg_temp.must(failed, 'A must not escalate the own role');
  perform pg_temp.as_owner();

  -- 3. technician B is isolated from A
  perform pg_temp.as_user(ub);
  perform pg_temp.must((select count(*) from public.v_my_violations) = 1 and (select description from public.v_my_violations) = 'zz bravo finding', 'B sees only B violation');
  perform pg_temp.must(public.technician_can_read_object('zz/bravo-shared.pdf'), 'B may open own shared evidence');
  perform pg_temp.must(not public.technician_can_read_object('zz/alpha-shared.pdf'), 'B must not open A evidence');
  perform pg_temp.as_owner();

  -- 4. staff behaviour is unchanged
  perform pg_temp.as_user(uv);
  perform pg_temp.must((select count(*) from public.technicians) >= 2, 'viewer still reads technicians');
  perform pg_temp.must((select count(*) from public.v_my_violations) = 0, 'viewer has no portal rows');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(uadm);
  perform pg_temp.must((select count(*) from public.violations) >= 2, 'admin still reads violations');
  perform pg_temp.must((select count(*) from public.audit_log where table_name = 'technician_accounts') >= 2, 'linking is audit-logged');
  failed := false; begin update public.profiles set role = 'qa' where user_id = ua; exception when others then failed := true; end;
  perform pg_temp.must(failed, 'a linked account cannot be re-roled without unlinking');
  perform pg_temp.as_owner();

  -- 5. deactivated employees lose portal access; unlinking ends access
  update public.technicians set employment_status = 'Terminated', date_separated = current_date where id = ta;
  perform pg_temp.as_user(ua);
  perform pg_temp.must((select count(*) from public.v_my_profile) = 0 and (select count(*) from public.v_my_violations) = 0, 'a deactivated employee has no portal access');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(uadm);
  perform public.unlink_technician_account(ub);
  perform pg_temp.as_owner();
  perform pg_temp.as_user(ub);
  perform pg_temp.must((select count(*) from public.v_my_violations) = 0 and (select count(*) from public.technicians) = 0, 'an unlinked account sees nothing');
  perform pg_temp.as_owner();
end $$;

rollback;
select 'ALL TECHNICIAN RLS TESTS PASSED (transaction rolled back, nothing was kept)' as result;
