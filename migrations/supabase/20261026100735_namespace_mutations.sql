-- Dormant install only. Activate separately after the compatible application is ready.
begin;
create table public.moontv_mutation_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.moontv_mutation_control(singleton,enabled) values(true,false);
create table public.moontv_mutation_state (
  username text not null,
  namespace text not null check (namespace in ('pr','fav','sh','followings')),
  epoch uuid not null default gen_random_uuid(),
  revision bigint not null default 0 check (revision >= 0),
  last_operation uuid,
  last_request_hash text,
  last_result jsonb,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (username,namespace)
);
alter table public.moontv_mutation_control enable row level security;
alter table public.moontv_mutation_state enable row level security;
revoke all on public.moontv_mutation_control, public.moontv_mutation_state from public, anon, authenticated;
grant select on public.moontv_mutation_control to service_role;
grant select,insert,update,delete on public.moontv_mutation_state to service_role;

create function public.moontv_namespace_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  target text; user_name text; ns text; marker text;
begin
  if not (select enabled from public.moontv_mutation_control where singleton) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  target := case when tg_op='DELETE' then old.key else new.key end;
  -- Key moves could otherwise evade the OLD namespace's guard.
  if tg_op='UPDATE' and old.key is distinct from new.key then
    raise exception 'KV key moves are disabled' using errcode='22023';
  end if;
  user_name := substring(target from '^u:([^:]+):');
  if user_name is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  marker := current_setting('moontv.namespace_write',true);
  if target='u:'||user_name||':pwd' and tg_op in ('INSERT','DELETE') then
    perform pg_advisory_xact_lock(hashtextextended('moontv-user:'||user_name,0));
    -- BEFORE INSERT also runs for an upsert that will become UPDATE.
    if tg_op='DELETE' or not exists (select 1 from public.moontv_kv where key=target) then
      delete from public.moontv_mutation_state where username=user_name;
    end if;
  end if;
  ns := case
    when starts_with(target,'u:'||user_name||':pr:') then 'pr'
    when starts_with(target,'u:'||user_name||':fav:') then 'fav'
    when starts_with(target,'u:'||user_name||':following:') then 'followings'
    when target='u:'||user_name||':sh' then 'sh'
    else null end;
  if ns is not null and coalesce(marker,'') not in ('lifecycle',user_name||':'||ns) then
    raise exception 'Versioned namespace mutation required' using errcode='P0001';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger moontv_namespace_write_guard before insert or update or delete on public.moontv_kv
for each row execute function public.moontv_namespace_guard();

create function public.moontv_prepare_namespace(p_table text,p_username text,p_namespace text,p_is_owner boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare s public.moontv_mutation_state%rowtype; payload jsonb; prefix text;
begin
  if p_table is distinct from 'moontv_kv' or p_namespace not in ('pr','fav','sh','followings')
    or p_namespace is null or p_username is null or p_username='' or p_username<>btrim(p_username)
    or p_username ~ '[:[:cntrl:]]' then
    raise exception 'Invalid namespace' using errcode='22023';
  end if;
  -- Compatible with other users' writers; conflicts with the full restore lock.
  lock table public.moontv_kv in row exclusive mode;
  if not (select enabled from public.moontv_mutation_control where singleton) then
    raise exception 'Namespace protocol not activated' using errcode='55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('moontv-user:'||p_username,0));
  -- Owner may intentionally have no credential row (environment password).
  if not coalesce(p_is_owner,false) and not exists(select 1 from public.moontv_kv where key='u:'||p_username||':pwd')
    and not exists(select 1 from public.moontv_kv c,
      jsonb_array_elements(c.value#>'{UserConfig,Users}') u
      where c.key='admin:config' and u->>'username'=p_username and u->>'role'='owner') then
    raise exception 'Account no longer exists' using errcode='28000';
  end if;
  insert into public.moontv_mutation_state(username,namespace) values(p_username,p_namespace)
    on conflict do nothing;
  select * into s from public.moontv_mutation_state where username=p_username and namespace=p_namespace for update;
  return jsonb_build_object('epoch',s.epoch::text,'revision',s.revision::text);
end;
$$;

create function public.moontv_read_namespace(p_table text,p_username text,p_namespace text,p_is_owner boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare version jsonb; payload jsonb; prefix text;
begin
  version := public.moontv_prepare_namespace(p_table,p_username,p_namespace,p_is_owner);
  if p_namespace='sh' then
    select value into payload from public.moontv_kv where key='u:'||p_username||':sh';
    payload := coalesce(payload,'[]'::jsonb);
  else
    prefix := 'u:'||p_username||':'||(case when p_namespace='followings' then 'following' else p_namespace end)||':';
    select coalesce(jsonb_object_agg(substring(key from length(prefix)+1),value),'{}'::jsonb)
      into payload from public.moontv_kv where starts_with(key,prefix);
  end if;
  return jsonb_build_object('version',version,'data',payload);
end;
$$;

create function public.moontv_mutate_namespace(
  p_table text,p_username text,p_namespace text,p_epoch uuid,p_revision bigint,
  p_operation uuid,p_action text,p_key text,p_value jsonb,p_is_owner boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare snap jsonb; s public.moontv_mutation_state%rowtype; request_hash text;
  target text; prefix text; payload jsonb; result jsonb; previous_marker text;
begin
  snap := public.moontv_prepare_namespace(p_table,p_username,p_namespace,p_is_owner);
  if p_operation is null or p_epoch is null or p_revision is null or p_revision<0
    or p_action is null or p_action not in ('set','delete','clear','add') then
    raise exception 'Invalid mutation' using errcode='22023';
  end if;
  if p_namespace='sh' then
    if p_action not in ('add','delete','clear')
      or (p_action in ('add','delete') and (p_key is null or length(p_key)=0 or length(p_key)>1024)) then
      raise exception 'Invalid history mutation' using errcode='22023';
    end if;
  elsif p_action not in ('set','delete','clear')
    or (p_action in ('set','delete') and (p_key is null or length(p_key)=0 or length(p_key)>2048))
    or (p_action='set' and jsonb_typeof(p_value) is distinct from 'object') then
    raise exception 'Invalid record mutation' using errcode='22023';
  end if;
  request_hash := encode(sha256(convert_to(jsonb_build_array(p_epoch,p_revision,p_action,p_key,p_value)::text,'UTF8')),'hex');
  select * into s from public.moontv_mutation_state where username=p_username and namespace=p_namespace;
  if s.last_operation=p_operation then
    if s.last_request_hash is distinct from request_hash then
      raise exception 'Operation identifier reused with different content' using errcode='22023';
    end if;
    -- Only the last receipt is retained. Later writes invalidate old retries.
    if p_namespace='sh' then
      select value into payload from public.moontv_kv where key='u:'||p_username||':sh';
    end if;
    return jsonb_build_object('version',snap,'data',coalesce(payload,'{}'::jsonb),'duplicate',true);
  end if;
  if s.epoch<>p_epoch or s.revision<>p_revision then
    raise exception 'NAMESPACE_CONFLICT' using errcode='40001';
  end if;
  previous_marker := current_setting('moontv.namespace_write',true);
  perform set_config('moontv.namespace_write',p_username||':'||p_namespace,true);
  if p_namespace='sh' then
    target := 'u:'||p_username||':sh';
    select value into payload from public.moontv_kv where key=target;
    payload := coalesce(payload,'[]'::jsonb);
    if p_action='clear' then payload := '[]'::jsonb;
    else
      select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into payload
      from jsonb_array_elements_text(payload) with ordinality e(v,ord) where v<>p_key;
      if p_action='add' then payload := jsonb_build_array(p_key)||payload; end if;
      select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into payload
      from jsonb_array_elements(payload) with ordinality e(v,ord) where ord<=20;
    end if;
    insert into public.moontv_kv(key,value) values(target,payload)
      on conflict(key) do update set value=excluded.value,updated_at=statement_timestamp();
  else
    prefix := 'u:'||p_username||':'||(case when p_namespace='followings' then 'following' else p_namespace end)||':';
    target := prefix||coalesce(p_key,'');
    if p_action='clear' then delete from public.moontv_kv where starts_with(key,prefix);
    elsif p_action='delete' then delete from public.moontv_kv where key=target;
    else insert into public.moontv_kv(key,value) values(target,p_value)
      on conflict(key) do update set value=excluded.value,updated_at=statement_timestamp();
    end if;
  end if;
  perform set_config('moontv.namespace_write',coalesce(previous_marker,''),true);
  update public.moontv_mutation_state set revision=revision+1,last_operation=p_operation,
    last_request_hash=request_hash,updated_at=statement_timestamp()
    where username=p_username and namespace=p_namespace;
  result := jsonb_build_object('version',jsonb_build_object('epoch',s.epoch::text,'revision',(s.revision+1)::text),'duplicate',false,'data',coalesce(payload,'{}'::jsonb));
  update public.moontv_mutation_state set last_result=jsonb_build_object('version',result->'version')
    where username=p_username and namespace=p_namespace;
  return result;
end;
$$;
revoke all on function public.moontv_prepare_namespace(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.moontv_prepare_namespace(text,text,text,boolean) to service_role;
revoke all on function public.moontv_namespace_guard() from public,anon,authenticated;
revoke all on function public.moontv_read_namespace(text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.moontv_mutate_namespace(text,text,text,uuid,bigint,uuid,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.moontv_namespace_guard() to service_role;
grant execute on function public.moontv_read_namespace(text,text,text,boolean) to service_role;
grant execute on function public.moontv_mutate_namespace(text,text,text,uuid,bigint,uuid,text,text,jsonb,boolean) to service_role;

-- Lifecycle operations preserve existing validation/ACLs and lock order.
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
  perform set_config('moontv.namespace_write','lifecycle',true);
  execute format('delete from public.%I', p_table);
  execute format(
    'insert into public.%I (key, value, updated_at) select row->>''key'', row->''value'', statement_timestamp() from jsonb_array_elements($1) as r(row)',
    p_table
  ) using p_rows;
  get diagnostics restored = row_count;
  delete from public.moontv_mutation_state;
  perform set_config('moontv.namespace_write','',true);
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
  lock table public.moontv_kv in row exclusive mode;
  perform pg_advisory_xact_lock(hashtextextended('moontv-user:'||p_username,0));
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
  perform pg_advisory_xact_lock(hashtextextended('moontv-user:'||p_username,0));
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
  perform set_config('moontv.namespace_write','lifecycle',true);
  delete from public.moontv_kv where starts_with(key, user_prefix);
  delete from public.moontv_mutation_state where username=p_username;
  perform set_config('moontv.namespace_write','',true);
  update public.moontv_kv set value=p_next_config, updated_at=statement_timestamp()
    where key='admin:config';
  return true;
end;
$$;


notify pgrst, 'reload schema';
commit;
