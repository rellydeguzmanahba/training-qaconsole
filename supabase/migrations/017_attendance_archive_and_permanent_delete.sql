-- 017_attendance_archive_and_permanent_delete.sql
begin;
alter table public.training_sessions add column if not exists archived_at timestamptz;
alter table public.training_sessions add column if not exists archived_by uuid references auth.users(id);
drop function if exists public.attendance_admin_sessions();
create function public.attendance_admin_sessions()
returns table(id uuid,title text,venue text,starts_at timestamptz,ends_at timestamptz,
 qr_token uuid,participants bigint,checked_in bigint,training_type_id integer,archived_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 return query select s.id,s.title,s.venue,s.starts_at,s.ends_at,s.qr_token,
 count(a.technician_id),count(a.time_in),s.training_type_id,s.archived_at
 from public.training_sessions s left join public.training_attendance a on a.session_id=s.id
 group by s.id order by s.starts_at desc limit 200;
end $$;
create or replace function public.attendance_set_archived(p_session_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 update public.training_sessions set archived_at=case when p_archived then now() else null end,
 archived_by=case when p_archived then auth.uid() else null end where id=p_session_id;
 if not found then raise exception 'Session not found'; end if;
end $$;
create or replace function public.attendance_delete_session(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Admin access required'; end if;
 perform 1 from public.training_sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 -- Training attendance records are removed by the FK's ON DELETE CASCADE.
 delete from public.training_sessions where id=p_session_id;
end $$;
revoke all on function public.attendance_admin_sessions(),public.attendance_set_archived(uuid,boolean),
 public.attendance_delete_session(uuid) from public,anon;
grant execute on function public.attendance_admin_sessions(),public.attendance_set_archived(uuid,boolean),
 public.attendance_delete_session(uuid) to authenticated;
commit;
