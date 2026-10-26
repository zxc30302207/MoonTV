-- Correct existing installations whose schema defaults granted service_role ALL.
-- Grants only: does not alter rows, functions, RLS, activation or existing KV ACLs.
begin;
revoke all privileges on table public.moontv_mutation_control,
  public.moontv_mutation_state, public.moontv_rate_buckets from service_role;
grant select on table public.moontv_mutation_control to service_role;
grant select, insert, update, delete on table public.moontv_mutation_state,
  public.moontv_rate_buckets to service_role;
commit;
