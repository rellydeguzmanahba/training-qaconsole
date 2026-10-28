-- 013_my_training.sql
-- REVIEW before applying. Depends on 010a and 010b technician security.
-- Personal training progress; the client never supplies a technician id.
begin;
create or replace view public.v_my_training with (security_barrier = true) as
select tt.id as training_type_id, tt.name, tt.required,
       (select max(tr.completed_on) from public.training_records tr
        where tr.technician_id = public.my_technician_id()
          and tr.training_type_id = tt.id) as completed_on
from public.training_types tt
where tt.active = true and public.my_technician_id() is not null;
revoke all on public.v_my_training from public, anon;
grant select on public.v_my_training to authenticated;
commit;
