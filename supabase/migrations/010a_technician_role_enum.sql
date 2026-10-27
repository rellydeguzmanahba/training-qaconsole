-- 010a_technician_role_enum.sql | REVIEW BEFORE RUNNING. Not executed automatically.
-- Run this file ALONE first. A new enum value cannot be used until the statement has committed,
-- so everything that uses it lives in 010b_technician_security.sql.
alter type public.app_role add value if not exists 'technician';
