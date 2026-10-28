-- 016_attendance_session_management.sql
-- Edit sessions (admin/trainer); delete only empty sessions (admin).
begin;
drop function if exists public.attendance_admin_sessions();
create function public.attendance_admin_sessions()
returns table(id uuid, title text, venue text, starts_at timestamptz, ends_at timestamptz,
 qr_token uuid, participants bigint, checked_in bigint, training_type_id integer)
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 return query select s.id,s.title,s.venue,s.starts_at,s.ends_at,s.qr_token,
   count(a.technician_id),count(a.time_in),s.training_type_id
 from public.training_sessions s left join public.training_attendance a on a.session_id=s.id
 group by s.id order by s.starts_at desc limit 100;
end $$;

create or replace function public.attendance_update_session(
 p_session_id uuid,p_training_type_id integer,p_title text,p_starts_at timestamptz,
 p_ends_at timestamptz,p_venue text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.training_sessions%rowtype; v_grace interval;
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 select * into v_old from public.training_sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 if length(trim(coalesce(p_title,''))) not between 3 and 180 then raise exception 'Title must be 3 to 180 characters'; end if;
 if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'Invalid schedule'; end if;
 if not exists(select 1 from public.training_types where id=p_training_type_id and active) then raise exception 'Invalid training type'; end if;
 if exists(select 1 from public.training_attendance where session_id=p_session_id and time_in is not null)
 and (p_starts_at is distinct from v_old.starts_at or p_ends_at is distinct from v_old.ends_at
 or p_training_type_id is distinct from v_old.training_type_id) then
   raise exception 'Cannot change schedule or training type after attendance has started';
 end if;
 v_grace:=v_old.checkin_closes_at-v_old.starts_at;
 update public.training_sessions set training_type_id=p_training_type_id,title=trim(p_title),
 venue=nullif(trim(coalesce(p_venue,'')),''),starts_at=p_starts_at,ends_at=p_ends_at,
 checkin_opens_at=p_starts_at-interval '30 minutes',checkin_closes_at=p_starts_at+v_grace
 where id=p_session_id;
end $$;

create or replace function public.attendance_delete_session(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Admin access required'; end if;
 perform 1 from public.training_sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 if exists(select 1 from public.training_attendance where session_id=p_session_id) then
   raise exception 'Cannot delete a session with assigned employees or attendance records. Unassignments are not supported.';
 end if;
 delete from public.training_sessions where id=p_session_id;
end $$;
revoke all on function public.attendance_admin_sessions() from public,anon;
grant execute on function public.attendance_admin_sessions() to authenticated;
revoke all on function public.attendance_update_session(uuid,integer,text,timestamptz,timestamptz,text),
 public.attendance_delete_session(uuid) from public,anon;
grant execute on function public.attendance_update_session(uuid,integer,text,timestamptz,timestamptz,text),
 public.attendance_delete_session(uuid) to authenticated;
commit;
