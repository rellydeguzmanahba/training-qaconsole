-- verify_security.sql | READ-ONLY checks. Run in the SQL editor after setup; every "EXPECT" must hold.

-- 1. EXPECT 0 rows: public tables without row level security
select tablename as table_without_rls from pg_tables where schemaname = 'public' and not rowsecurity;

-- 2. EXPECT 0 rows: tables with RLS but no policy at all (they would be unreadable by everyone)
select c.relname as table_without_policy from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

-- 3. EXPECT 0 rows: anything the anonymous (not logged in) role can touch in public
select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
select routine_name from information_schema.role_routine_grants where routine_schema = 'public' and grantee in ('anon', 'PUBLIC');

-- 4. EXPECT public = false for the evidence bucket
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'evidence';

-- 5. EXPECT every SECURITY DEFINER function to pin its search_path (proconfig contains search_path)
select p.proname, p.prosecdef as security_definer, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false);

-- 6. EXPECT 0 rows: views that would bypass RLS (must be security_invoker)
select c.relname as view_without_security_invoker from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text like '%security_invoker=true%', false);

-- 7. EXPECT at least one active admin, and review inactive accounts
select role, active, count(*) from public.profiles group by 1, 2 order by 1, 2;

-- 8. Info: policies per table
select tablename, count(*) as policies from pg_policies where schemaname in ('public', 'storage') group by 1 order by 1;
