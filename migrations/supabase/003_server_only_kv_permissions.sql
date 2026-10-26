-- Separate, approval-gated security hardening. Review before live execution.
-- For a custom SUPABASE_KV_TABLE, replace the identifier below after verifying it.
-- No row data is changed, and no anon/authenticated RLS policy is added.
begin;
grant select, insert, update, delete on table public.moontv_kv to service_role;
revoke all on table public.moontv_kv from anon, authenticated;
commit;
