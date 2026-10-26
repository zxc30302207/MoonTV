-- Review and apply as one transaction BEFORE enabling atomic registration/backup.
-- This migration only installs functions; it never rewrites existing rows.
-- All functions are SECURITY INVOKER: the caller still needs table privileges.
-- This installation explicitly allows ONLY public.moontv_kv. A custom table
-- requires a separately reviewed migration; p_table is not an arbitrary target.
begin;

create or replace function public.moontv_kv_capabilities()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select '{"api_version":1,"atomic_restore":true,"atomic_registration":true,"snapshot":true}'::jsonb;
$$;

create or replace function public.moontv_snapshot_kv(p_table text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_table is distinct from 'moontv_kv' then
    raise exception 'KV table is not approved for this installation' using errcode = '22023';
  end if;
  -- One SELECT / MVCC snapshot; no OFFSET pages that can drift under writes.
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''key'', key, ''value'', value) order by key), ''[]''::jsonb) from public.%I',
    p_table
  ) into result;
  return result;
end;
$$;

create or replace function public.moontv_restore_kv(p_table text, p_rows jsonb)
returns integer
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  restored integer;
begin
  if p_table is distinct from 'moontv_kv' then
    raise exception 'KV table is not approved for this installation' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Backup rows must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as r(row)
    where jsonb_typeof(row) <> 'object'
      or jsonb_typeof(row->'key') is distinct from 'string'
      or length(row->>'key') = 0
      or not (row ? 'value')
  ) then
    raise exception 'Invalid backup row' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows) as r(row)
      where row->>'key' = 'admin:config' and jsonb_typeof(row->'value') = 'object') <> 1 then
    raise exception 'Backup requires one admin configuration' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as r(row)
    group by row->>'key' having count(*) > 1
  ) then
    raise exception 'Duplicate backup keys' using errcode = '22023';
  end if;

  -- Serialize replacement with ALL ordinary INSERT/UPDATE/DELETE statements,
  -- not just cooperating RPC calls. Readers can continue seeing the old state.
  -- A failure/time-out anywhere rolls back both DELETE and INSERT.
  execute format('lock table public.%I in share row exclusive mode', p_table);
  execute format('delete from public.%I', p_table);
  execute format(
    'insert into public.%I (key, value, updated_at) select row->>''key'', row->''value'', statement_timestamp() from jsonb_array_elements($1) as r(row)',
    p_table
  ) using p_rows;
  get diagnostics restored = row_count;
  return restored;
end;
$$;

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
    'insert into public.%I (key, value, updated_at) values ($1, to_jsonb($2::text), statement_timestamp())',
    p_table
  ) using 'u:' || p_username || ':pwd', p_password_hash;
  return true;
end;
$$;

-- No PUBLIC execute window: creation/replacement and ACL changes commit together.
revoke all on function public.moontv_kv_capabilities() from public, anon, authenticated;
revoke all on function public.moontv_snapshot_kv(text) from public, anon, authenticated;
revoke all on function public.moontv_restore_kv(text, jsonb) from public, anon, authenticated;
revoke all on function public.moontv_register_user(text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.moontv_kv_capabilities() to service_role;
grant execute on function public.moontv_snapshot_kv(text) to service_role;
grant execute on function public.moontv_restore_kv(text, jsonb) to service_role;
grant execute on function public.moontv_register_user(text, jsonb, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
