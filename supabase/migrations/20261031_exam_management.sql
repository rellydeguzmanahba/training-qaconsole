-- AHBA Examination Management (run once in Supabase SQL Editor).
-- Review before applying; this creates new objects and does not alter existing training records.
create extension if not exists pgcrypto;
create table if not exists public.exam_questions (
 id uuid primary key default gen_random_uuid(),
 topic text not null default 'General',
 question text not null,
 choices jsonb not null check (jsonb_typeof(choices)='array' and jsonb_array_length(choices)=4),
 correct_index integer not null check (correct_index between 0 and 3),
 difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.exams (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 question_count integer not null check (question_count between 1 and 200),
 passing_percent integer not null default 80 check (passing_percent between 0 and 100),
 duration_minutes integer not null default 60 check (duration_minutes between 1 and 240),
 max_attempts integer not null default 1 check (max_attempts between 1 and 20),
 starts_at timestamptz,
 ends_at timestamptz,
 active boolean not null default false,
 created_at timestamptz not null default now(),
 check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table if not exists public.exam_pool (
 exam_id uuid not null references public.exams(id) on delete cascade,
 question_id uuid not null references public.exam_questions(id),
 primary key(exam_id,question_id)
);
create table if not exists public.exam_assignments (
 exam_id uuid not null references public.exams(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(exam_id,user_id)
);
create table if not exists public.exam_attempts (
 id uuid primary key default gen_random_uuid(),
 exam_id uuid not null references public.exams(id),
 user_id uuid not null references auth.users(id),
 attempt_number integer not null,
 started_at timestamptz not null default now(),
 submitted_at timestamptz,
 score integer,
 total integer,
 passed boolean,
 unique(exam_id,user_id,attempt_number)
);
create table if not exists public.exam_attempt_items (
 attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
 position integer not null,
 question_id uuid not null references public.exam_questions(id),
 choice_order jsonb not null,
 selected_position integer,
 primary key(attempt_id,position),
 unique(attempt_id,question_id)
);
create index if not exists exam_attempts_user_idx on public.exam_attempts(user_id,exam_id);
create index if not exists exam_pool_exam_idx on public.exam_pool(exam_id);
create or replace function public.exam_is_trainer() returns boolean language sql stable security definer set search_path = public as $$
 select exists(select 1 from public.profiles where user_id=auth.uid() and role in ('admin','trainer') and active is true);
$$;
revoke all on function public.exam_is_trainer() from public;
grant execute on function public.exam_is_trainer() to authenticated;
alter table public.exam_questions enable row level security;
alter table public.exams enable row level security;
alter table public.exam_pool enable row level security;
alter table public.exam_assignments enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_attempt_items enable row level security;
drop policy if exists "trainers manage questions" on public.exam_questions;
create policy "trainers manage questions" on public.exam_questions for all to authenticated using (public.exam_is_trainer()) with check (public.exam_is_trainer());
drop policy if exists "trainers manage exams" on public.exams;
create policy "trainers manage exams" on public.exams for all to authenticated using (public.exam_is_trainer()) with check (public.exam_is_trainer());
drop policy if exists "assigned users view exams" on public.exams;
create policy "assigned users view exams" on public.exams for select to authenticated using (active and exists(select 1 from public.exam_assignments a where a.exam_id=id and a.user_id=auth.uid()));
drop policy if exists "trainers manage pool" on public.exam_pool;
create policy "trainers manage pool" on public.exam_pool for all to authenticated using (public.exam_is_trainer()) with check (public.exam_is_trainer());
drop policy if exists "trainers manage assignments" on public.exam_assignments;
create policy "trainers manage assignments" on public.exam_assignments for all to authenticated using (public.exam_is_trainer()) with check (public.exam_is_trainer());
drop policy if exists "users view own assignments" on public.exam_assignments;
create policy "users view own assignments" on public.exam_assignments for select to authenticated using (user_id=auth.uid());
drop policy if exists "trainers view attempts" on public.exam_attempts;
create policy "trainers view attempts" on public.exam_attempts for select to authenticated using (public.exam_is_trainer());
drop policy if exists "users view own attempts" on public.exam_attempts;
create policy "users view own attempts" on public.exam_attempts for select to authenticated using (user_id=auth.uid());
-- No direct client access to answer keys or attempt items. RPCs below control them.
create or replace function public.exam_start(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.exams%rowtype; a public.exam_attempts%rowtype; n integer; q record; k integer:=0; ord jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into e from public.exams where id=p_exam_id and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now());
 if not found then raise exception 'Exam is not open'; end if;
 if not exists(select 1 from public.exam_assignments where exam_id=e.id and user_id=auth.uid()) then raise exception 'Exam is not assigned to you'; end if;
 perform pg_advisory_xact_lock(hashtext(e.id::text || auth.uid()::text));
 select * into a from public.exam_attempts where exam_id=e.id and user_id=auth.uid() and submitted_at is null order by started_at desc limit 1;
 if not found then
   select count(*) into n from public.exam_attempts where exam_id=e.id and user_id=auth.uid();
   if n>=e.max_attempts then raise exception 'Attempt limit reached'; end if;
   if (select count(*) from public.exam_pool ep join public.exam_questions eq on eq.id=ep.question_id where ep.exam_id=e.id and eq.active)>=e.question_count then
     insert into public.exam_attempts(exam_id,user_id,attempt_number) values(e.id,auth.uid(),n+1) returning * into a;
     for q in select eq.id from public.exam_pool ep join public.exam_questions eq on eq.id=ep.question_id where ep.exam_id=e.id and eq.active
       order by (select count(*) from public.exam_attempt_items ai join public.exam_attempts at on at.id=ai.attempt_id where at.user_id=auth.uid() and ai.question_id=eq.id),random() limit e.question_count
     loop
       k:=k+1;
       select jsonb_agg(x.i order by x.r) into ord from (select i,random() r from generate_series(0,3) i) x;
       insert into public.exam_attempt_items(attempt_id,position,question_id,choice_order) values(a.id,k,q.id,ord);
     end loop;
   else raise exception 'Question pool is smaller than exam size'; end if;
 end if;
 if now()>a.started_at+make_interval(mins=>e.duration_minutes) or (e.ends_at is not null and now()>e.ends_at) then raise exception 'Exam time has expired'; end if;
 return jsonb_build_object('attempt_id',a.id,'deadline',least(a.started_at+make_interval(mins=>e.duration_minutes),coalesce(e.ends_at,'infinity'::timestamptz)),
 'questions',(select coalesce(jsonb_agg(jsonb_build_object('position',ai.position,'question',eq.question,'choices',(select jsonb_agg(eq.choices->(v.value::int) order by v.ordinality) from jsonb_array_elements_text(ai.choice_order) with ordinality v(value,ordinality))) order by ai.position),'[]'::jsonb)
 from public.exam_attempt_items ai join public.exam_questions eq on eq.id=ai.question_id where ai.attempt_id=a.id));
end $$;
create or replace function public.exam_submit(p_attempt_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.exam_attempts%rowtype; e public.exams%rowtype; q record; chosen int; points int:=0; total_count int:=0; answer jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into a from public.exam_attempts where id=p_attempt_id and user_id=auth.uid() for update;
 if not found then raise exception 'Attempt not found'; end if;
 if a.submitted_at is not null then raise exception 'Already submitted'; end if;
 select * into e from public.exams where id=a.exam_id;
 if jsonb_typeof(p_answers)<>'object' then raise exception 'Answers must be an object'; end if;
 for q in select ai.position,ai.choice_order,eq.correct_index from public.exam_attempt_items ai join public.exam_questions eq on eq.id=ai.question_id where ai.attempt_id=a.id loop
  total_count:=total_count+1;
  answer:=p_answers->(q.position::text);
  chosen:=null;
  if answer is not null and jsonb_typeof(answer)='number' then
   chosen:=(answer #>> '{}')::int;
   if chosen<0 or chosen>3 then chosen:=null; end if;
  end if;
  if chosen is not null and (q.choice_order->>chosen)::int=q.correct_index then points:=points+1; end if;
  update public.exam_attempt_items set selected_position=chosen where attempt_id=a.id and position=q.position;
 end loop;
 update public.exam_attempts set submitted_at=now(),score=points,total=total_count,passed=(points*100>=e.passing_percent*greatest(total_count,1)) where id=a.id;
 return jsonb_build_object('score',points,'total',total_count,'passed',points*100>=e.passing_percent*greatest(total_count,1));
end $$;
revoke all on function public.exam_start(uuid),public.exam_submit(uuid,jsonb) from public;
grant execute on function public.exam_start(uuid),public.exam_submit(uuid,jsonb) to authenticated;
