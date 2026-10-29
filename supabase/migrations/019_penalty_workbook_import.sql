-- 019_penalty_workbook_import.sql
-- Admin-only, atomic policy reference imports. Existing history and offense decisions are untouched.
begin;
create or replace function public.qa_import_penalty_reference(p_rows jsonb,p_replace boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare item jsonb; n integer:=0; code text; kind text; description text; penalty text; source text;
begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Only admins may import penalty policies'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000
 then raise exception 'Import requires 1 to 1000 policy entries'; end if;
 -- Validate every row before making any changes.
 for item in select value from jsonb_array_elements(p_rows) loop
  code:=btrim(coalesce(item->>'violation_code',''));
  kind:=btrim(coalesce(item->>'violation_type',''));
  penalty:=btrim(coalesce(item->>'penalty_text',''));
  if code='' or kind='' or penalty='' or length(code)>100 or length(kind)>500 or length(penalty)>10000
  then raise exception 'Invalid policy row: code, violation type and penalty are required'; end if;
 end loop;
 if p_replace then delete from public.qa_penalty_reference; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  code:=btrim(item->>'violation_code');
  kind:=btrim(item->>'violation_type');
  description:=nullif(btrim(coalesce(item->>'description','')),'');
  penalty:=btrim(item->>'penalty_text');
  source:=left(coalesce(nullif(btrim(item->>'source_document'),''),'Imported policy workbook'),500);
  insert into public.qa_penalty_reference(violation_code,violation_type,description,penalty_text,source_document)
  values(code,kind,description,penalty,source)
  on conflict(violation_code,violation_type) do update
   set description=excluded.description,penalty_text=excluded.penalty_text,source_document=excluded.source_document;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.qa_import_penalty_reference(jsonb,boolean) from public,anon;
grant execute on function public.qa_import_penalty_reference(jsonb,boolean) to authenticated;
commit;
