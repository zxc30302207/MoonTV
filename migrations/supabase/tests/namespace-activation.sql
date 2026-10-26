-- OPERATOR-REVIEWED CUTOVER ONLY. Not applied by the application or install file.
-- Acquire the same relation lock before the flag so old in-flight writes finish
-- first. At commit all future unversioned managed writes are rejected, including
-- old deployment instances. Do not activate until compatible code is ready.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.moontv_kv in share row exclusive mode;
-- Rotate any earlier generations, including a reviewed reactivation after rollback.
update public.moontv_mutation_state set epoch=gen_random_uuid(), revision=0,
  last_operation=null, last_request_hash=null, last_result=null, updated_at=statement_timestamp();
update public.moontv_mutation_control set enabled=true where singleton;
commit;
