-- Separate approval required: upgrades only the registration RPC definition.
-- Existing application rows are untouched. No registration is invoked here.
-- The application must use a freshly salted hash for every new registration
-- and capture its corresponding session version, never fetch another request's
-- latest credential to issue this registration's session.
begin;

create or replace function public.moontv_register_user(
  p_table text,
  p_expected_config jsonb,
  p_next_config jsonb,
  p_username text,
  p_password_hash text
)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  changed integer;
begin
  if p_table is distinct from 'moontv_kv' then
    raise exception 'KV table is not approved for this installation' using errcode = '22023';
  end if;
  if p_username is null or length(p_username) = 0
    or p_username <> btrim(p_username) or p_username ~ '[:[:cntrl:]]'
    or p_password_hash is null or length(p_password_hash) = 0
    or jsonb_typeof(p_expected_config) is distinct from 'object'
    or jsonb_typeof(p_next_config) is distinct from 'object' then
    raise exception 'Invalid registration arguments' using errcode = '22023';
  end if;
  execute format(
    'update public.%I set value=$1, updated_at=statement_timestamp() where key=''admin:config'' and value=$2',
    p_table
  ) using p_next_config, p_expected_config;
  get diagnostics changed = row_count;
  if changed = 0 then
    return false;
  end if;
  -- A duplicate credential or any other INSERT failure aborts the transaction,
  -- so registration never leaves a config-only reservation behind.
  execute format(
    'insert into public.%I (key, value, updated_at) values ($1, jsonb_build_object(''hash'', $2::text, ''revokedBefore'', floor(extract(epoch from clock_timestamp()) * 1000)::bigint), statement_timestamp())',
    p_table
  ) using 'u:' || p_username || ':pwd', p_password_hash;
  return true;
end;
$$;

revoke all on function public.moontv_register_user(text, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.moontv_register_user(text, jsonb, jsonb, text, text)
  to service_role;
notify pgrst, 'reload schema';
commit;
