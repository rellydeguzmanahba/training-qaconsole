-- 014_training_attendance.sql
-- Apply after 010b. Session QR uses a random token; employee identity always comes from auth.uid().
begin;
create table if not exists public.training_sessions (
 id uuid primary key default gen_random_uuid(),
 training_type_id uuid not null references public.training_types(id),
 title text not null check(length(trim(title)) between 3 and 180),
 venue text,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 checkin_opens_at timestamptz not null,
 checkin_closes_at timestamptz not null,
 qr_token uuid not null unique default gen_random_uuid(),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 check (ends_at > starts_at),
 check (checkin_closes_at >= checkin_opens_at)
);
create table if not exists public.training_attendance (
 session_id uuid not null references public.training_sessions(id) on delete cascade,
 technician_id uuid not null references public.technicians(id),
 time_in timestamptz,
 time_out timestamptz,
 checked_in_via text check (checked_in_via in ('button','qr')),
 primary key(session_id, technician_id),
 check (time_out is null or (time_in is not null and time_out >= time_in))
);
create index if not exists idx_training_sessions_starts on public.training_sessions(starts_at);
create index if not exists idx_training_attendance_tech on public.training_attendance(technician_id);
alter table public.training_sessions enable row level security;
alter table public.training_attendance enable row level security;
revoke all on public.training_sessions, public.training_attendance from public, anon, authenticated;

-- Employee view is scoped by the server-side account link. QR secret is never exposed.
create or replace view public.v_my_training_sessions with (security_barrier=true) as
select s.id, s.title, s.venue, s.starts_at, s.ends_at, s.checkin_opens_at, s.checkin_closes_at,
       a.time_in, a.time_out,
       case when a.time_out is not null then 'Checked out'
            when a.time_in is not null then 'Checked in'
            when now() > s.ends_at then 'Absent'
            else 'Upcoming' end as attendance_status
from public.training_attendance a
join public.training_sessions s on s.id = a.session_id
where a.technician_id = public.my_technician_id();
revoke all on public.v_my_training_sessions from public, anon;
grant select on public.v_my_training_sessions to authenticated;

-- Staff-only session list. QR token returned only to authorized training managers.
create or replace function public.attendance_admin_sessions()
returns table(id uuid, title text, venue text, starts_at timestamptz, ends_at timestamptz,
 qr_token uuid, participants bigint, checked_in bigint)
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 return query select s.id,s.title,s.venue,s.starts_at,s.ends_at,s.qr_token,
   count(a.technician_id),count(a.time_in)
 from public.training_sessions s left join public.training_attendance a on a.session_id=s.id
 group by s.id order by s.starts_at desc limit 100;
end $$;

create or replace function public.attendance_create_session(
 p_training_type_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
 p_venue text default null, p_grace_minutes integer default 15)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 if p_ends_at <= p_starts_at or p_grace_minutes < 0 or p_grace_minutes > 120 then raise exception 'Invalid schedule'; end if;
 if not exists(select 1 from public.training_types where id=p_training_type_id and active) then raise exception 'Invalid training type'; end if;
 insert into public.training_sessions(training_type_id,title,venue,starts_at,ends_at,checkin_opens_at,checkin_closes_at,created_by)
 values(p_training_type_id,trim(p_title),nullif(trim(p_venue),''),p_starts_at,p_ends_at,
 p_starts_at-interval '30 minutes',p_starts_at+make_interval(mins=>p_grace_minutes),auth.uid())
 returning id into v_id;
 return v_id;
end $$;

create or replace function public.attendance_assign(p_session_id uuid,p_technician_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.training_sessions where id=p_session_id) then raise exception 'Session not found'; end if;
 insert into public.training_attendance(session_id,technician_id) values(p_session_id,p_technician_id)
 on conflict do nothing;
end $$;

-- Employee can check in with a button (session id) or QR (secret token).
-- Session must be assigned and check-in must fall within the permitted window.
create or replace function public.attendance_time_in(p_session_id uuid default null,p_qr_token uuid default null)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_tech uuid; v_at timestamptz;
begin
 v_tech:=public.my_technician_id();
 if v_tech is null then raise exception 'Employee account is not linked'; end if;
 if (p_session_id is null) = (p_qr_token is null) then raise exception 'Provide exactly one session identifier'; end if;
 select id into v_id from public.training_sessions
 where (p_session_id is not null and id=p_session_id) or (p_qr_token is not null and qr_token=p_qr_token);
 if v_id is null then raise exception 'Session not found'; end if;
 if not exists(select 1 from public.training_sessions where id=v_id
   and now() between checkin_opens_at and checkin_closes_at) then raise exception 'Check-in window is closed'; end if;
 update public.training_attendance a set time_in=now(),
   checked_in_via=case when p_qr_token is not null then 'qr' else 'button' end
 where a.session_id=v_id and a.technician_id=v_tech and a.time_in is null
 returning a.time_in into v_at;
 if v_at is null then raise exception 'Not assigned or already checked in'; end if;
 return v_at;
end $$;

create or replace function public.attendance_time_out(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_at timestamptz;
begin
 if public.my_technician_id() is null then raise exception 'Employee account is not linked'; end if;
 update public.training_attendance a set time_out=now()
 from public.training_sessions s
 where a.session_id=p_session_id and a.session_id=s.id
   and a.technician_id=public.my_technician_id() and a.time_in is not null and a.time_out is null
   and now() <= s.ends_at + interval '4 hours'
 returning a.time_out into v_at;
 if v_at is null then raise exception 'Not checked in or check-out window closed'; end if;
 return v_at;
end $$;
revoke all on function public.attendance_admin_sessions(), public.attendance_create_session(uuid,text,timestamptz,timestamptz,text,integer),
 public.attendance_assign(uuid,uuid), public.attendance_time_in(uuid,uuid), public.attendance_time_out(uuid) from public,anon;
grant execute on function public.attendance_admin_sessions(), public.attendance_create_session(uuid,text,timestamptz,timestamptz,text,integer),
 public.attendance_assign(uuid,uuid), public.attendance_time_in(uuid,uuid), public.attendance_time_out(uuid) to authenticated;
commit;