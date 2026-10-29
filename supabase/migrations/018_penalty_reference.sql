-- 018_penalty_reference.sql
-- Reference-only policy table: displays workbook penalties; never applies sanctions automatically.
begin;
create table if not exists public.qa_penalty_reference (
 id bigint generated always as identity primary key,
 violation_code text not null,
 violation_type text not null,
 description text,
 penalty_text text not null,
 source_document text not null default 'PPM-OPG-PRP-008 Structured Penalty Program for Partners V1.0',
 unique(violation_code,violation_type)
);
alter table public.qa_penalty_reference enable row level security;
revoke all on public.qa_penalty_reference from public,anon;
grant select on public.qa_penalty_reference to authenticated;
drop policy if exists qa_penalty_reference_read on public.qa_penalty_reference;
create policy qa_penalty_reference_read on public.qa_penalty_reference for select to authenticated
using(public.has_role(array['admin','qa','trainer','supervisor','viewer']::public.app_role[]));
commit;
