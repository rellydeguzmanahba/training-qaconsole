-- 007_indexes.sql | Supporting indexes for list/report/dashboard queries. Safe to re-run.
create index if not exists violations_date_idx          on public.violations (violation_date desc);
create index if not exists violations_created_idx       on public.violations (created_at desc);
create index if not exists violations_action_idx        on public.violations (action_taken_id);
create index if not exists training_records_date_idx    on public.training_records (completed_on desc);
create index if not exists training_records_created_idx on public.training_records (created_at desc);
create index if not exists training_records_type_idx    on public.training_records (training_type_id);
create index if not exists retrainings_created_idx      on public.retrainings (created_at desc);
create index if not exists retrainings_result_idx       on public.retrainings (result);
create index if not exists retrainings_type_idx         on public.retrainings (training_type_id);
create index if not exists violation_links_cat_idx      on public.violation_category_links (category_id);
create index if not exists technician_access_sys_idx    on public.technician_access (access_id);
create index if not exists technicians_designation_idx  on public.technicians (designation_id);
analyze;
