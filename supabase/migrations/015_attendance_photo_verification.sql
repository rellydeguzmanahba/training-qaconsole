-- 015_attendance_photo_verification.sql
-- Run AFTER 014. Manual check-in requires a privately stored photo.
begin;
alter table public.training_attendance
 add column if not exists evidence_path text,
 add column if not exists verification_status text not null default 'not_required',
 add column if not exists reviewed_by uuid references auth.users(id),
 add column if not exists reviewed_at timestamptz,
 add column if not exists review_note text;
alter table public.training_attendance drop constraint if exists attendance_verification_status_check;
alter table public.training_attendance add constraint attendance_verification_status_check
 check(verification_status in ('not_required','pending','approved','rejected'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('training-attendance','training-attendance',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- A photo must be uploaded into the authenticated user's private prefix.
drop policy if exists attendance_employee_upload on storage.objects;
create policy attendance_employee_upload on storage.objects for insert to authenticated
with check(bucket_id='training-attendance' and (storage.foldername(name))[1]=auth.uid()::text
 and public.my_technician_id() is not null);
drop policy if exists attendance_photo_read on storage.objects;
create policy attendance_photo_read on storage.objects for select to authenticated
using(bucket_id='training-attendance' and
 ((storage.foldername(name))[1]=auth.uid()::text
 or public.has_role(array['admin','trainer']::public.app_role[])));

-- Old button check-in is deliberately disabled at the database layer.
create or replace function public.attendance_time_in(p_session_id uuid default null,p_qr_token uuid default null)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_tech uuid; v_at timestamptz;
begin
 v_tech:=public.my_technician_id();
 if v_tech is null then raise exception 'Employee account is not linked'; end if;
 if p_qr_token is null or p_session_id is not null then
   raise exception 'Manual check-in requires a training photo. Use attendance_photo_time_in.';
 end if;
 select id into v_id from public.training_sessions where qr_token=p_qr_token;
 if v_id is null then raise exception 'Session not found'; end if;
 if not exists(select 1 from public.training_sessions where id=v_id
 and now() between checkin_opens_at and checkin_closes_at) then raise exception 'Check-in window is closed'; end if;
 update public.training_attendance a set time_in=now(),checked_in_via='qr',
 verification_status='not_required'
 where a.session_id=v_id and a.technician_id=v_tech and a.time_in is null
 returning a.time_in into v_at;
 if v_at is null then raise exception 'Not assigned or already checked in'; end if;
 return v_at;
end $$;

create or replace function public.attendance_photo_time_in(p_session_id uuid,p_evidence_path text)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_tech uuid; v_at timestamptz;
begin
 v_tech:=public.my_technician_id();
 if v_tech is null then raise exception 'Employee account is not linked'; end if;
 if p_evidence_path !~ ('^'||auth.uid()::text||'/'||p_session_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$') then
  raise exception 'Invalid evidence path'; end if;
 if not exists(select 1 from storage.objects where bucket_id='training-attendance'
 and name=p_evidence_path and owner_id=auth.uid()::text
 and (metadata->>'mimetype') in ('image/jpeg','image/png','image/webp')
 and coalesce((metadata->>'size')::bigint,0) between 1 and 5242880)
 then raise exception 'Photo upload not found'; end if;
 if not exists(select 1 from public.training_sessions where id=p_session_id
 and now() between checkin_opens_at and checkin_closes_at)
 then raise exception 'Check-in window is closed'; end if;
 update public.training_attendance a set time_in=now(),checked_in_via='button',
 evidence_path=p_evidence_path,verification_status='pending'
 where a.session_id=p_session_id and a.technician_id=v_tech and a.time_in is null
 returning a.time_in into v_at;
 if v_at is null then raise exception 'Not assigned or already checked in'; end if;
 return v_at;
end $$;

-- Replace view to include verification state without exposing private file paths.
create or replace view public.v_my_training_sessions with (security_barrier=true) as
select s.id,s.title,s.venue,s.starts_at,s.ends_at,s.checkin_opens_at,s.checkin_closes_at,
 a.time_in,a.time_out,
 case when a.time_out is not null then 'Checked out'
 when a.time_in is not null then 'Checked in'
 when now()>s.ends_at then 'Absent' else 'Upcoming' end as attendance_status,
 a.verification_status
from public.training_attendance a join public.training_sessions s on s.id=a.session_id
where a.technician_id=public.my_technician_id();
grant select on public.v_my_training_sessions to authenticated;

create or replace function public.attendance_review_queue(p_session_id uuid)
returns table(technician_id uuid,employee_name text,time_in timestamptz,time_out timestamptz,
 evidence_path text,verification_status text,review_note text)
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 return query select a.technician_id,concat_ws(' ',t.first_name,t.surname),a.time_in,a.time_out,
 a.evidence_path,a.verification_status,a.review_note
 from public.training_attendance a join public.technicians t on t.id=a.technician_id
 where a.session_id=p_session_id order by t.surname,t.first_name;
end $$;

create or replace function public.attendance_review(p_session_id uuid,p_technician_id uuid,
 p_approved boolean,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','trainer']::public.app_role[]) then raise exception 'Not authorized'; end if;
 update public.training_attendance set verification_status=case when p_approved then 'approved' else 'rejected' end,
 reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(p_note,500)
 where session_id=p_session_id and technician_id=p_technician_id
 and checked_in_via='button' and evidence_path is not null and verification_status='pending';
 if not found then raise exception 'No pending photo attendance to review'; end if;
end $$;
revoke all on function public.attendance_photo_time_in(uuid,text),
 public.attendance_review_queue(uuid),public.attendance_review(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.attendance_photo_time_in(uuid,text),
 public.attendance_review_queue(uuid),public.attendance_review(uuid,uuid,boolean,text) to authenticated;
commit;