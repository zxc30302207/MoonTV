-- Separate approval required: installs a fifth server-only function.
-- Installing this migration does NOT delete any user or change application rows.
begin;

create or replace function public.moontv_delete_user(
  p_table text,
  p_expected_config jsonb,
  p_next_config jsonb,
  p_username text,
  p_expected_credential jsonb
)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  current_config jsonb;
  current_credential jsonb;
  remaining_users jsonb;
  expected_next jsonb;
  user_prefix text;
begin
  if p_table is distinct from 'moontv_kv' then
    raise exception 'KV table is not approved for this installation' using errcode = '22023';
  end if;
  if p_username is null or length(p_username) = 0
    or p_username <> btrim(p_username) or p_username ~ '[:[:cntrl:]]'
    or jsonb_typeof(p_expected_config) is distinct from 'object'
    or jsonb_typeof(p_next_config) is distinct from 'object'
    or jsonb_typeof(p_expected_config#>'{UserConfig,Users}') is distinct from 'array' then
    raise exception 'Invalid user deletion arguments' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_expected_config#>'{UserConfig,Users}') as u(entry)
      where entry->>'username'=p_username) <> 1 then
    raise exception 'Deletion requires exactly one configured target' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_expected_config#>'{UserConfig,Users}') as u(entry)
      where entry->>'username'=p_username and entry->>'role'='owner') then
    raise exception 'Cannot delete owner' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(entry order by ordinal), '[]'::jsonb)
    into remaining_users
    from jsonb_array_elements(p_expected_config#>'{UserConfig,Users}') with ordinality as u(entry,ordinal)
    where entry->>'username' is distinct from p_username;
  expected_next := jsonb_set(p_expected_config, '{UserConfig,Users}', remaining_users);
  if p_next_config is distinct from expected_next then
    raise exception 'Deletion may only remove the target membership' using errcode = '22023';
  end if;

  -- Same lock order as registration: config first, then credentials. A pending
  -- same-name registration cannot start until this transaction has committed.
  -- Take the write-intent table lock before row locks, so a full-table restore
  -- cannot hold its replacement lock while waiting on our config row lock.
  lock table public.moontv_kv in row exclusive mode;
  select value into current_config from public.moontv_kv
    where key='admin:config' for update;
  if current_config is distinct from p_expected_config then
    return false;
  end if;
  select value into current_credential from public.moontv_kv
    where key='u:' || p_username || ':pwd' for update;
  if coalesce(current_credential, 'null'::jsonb)
    is distinct from coalesce(p_expected_credential, 'null'::jsonb) then
    return false;
  end if;

  -- Exact namespace boundary, not LIKE wildcards. In particular '_' in a
  -- username must not match another account. Future per-user namespaces are
  -- cleaned up too, but no sibling username or global configuration is touched.
  user_prefix := 'u:' || p_username || ':';
  delete from public.moontv_kv where starts_with(key, user_prefix);
  update public.moontv_kv set value=p_next_config, updated_at=statement_timestamp()
    where key='admin:config';
  return true;
end;
$$;

revoke all on function public.moontv_delete_user(text, jsonb, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.moontv_delete_user(text, jsonb, jsonb, text, jsonb)
  to service_role;
notify pgrst, 'reload schema';
commit;
