-- Server-only, fixed-scope shared rate limiter. No user KV data is read or changed.
begin;
create table public.moontv_rate_buckets (
  scope text not null,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  count integer not null check (count > 0),
  reset_at timestamptz not null,
  primary key (scope, subject_hash)
);
create index moontv_rate_buckets_expiry on public.moontv_rate_buckets (reset_at);
alter table public.moontv_rate_buckets enable row level security;
revoke all on public.moontv_rate_buckets from public, anon, authenticated;
-- Explicitly replace inherited default grants; GRANT alone cannot narrow ALL.
revoke all on public.moontv_rate_buckets from service_role;
grant select, insert, update, delete on public.moontv_rate_buckets to service_role;

create function public.moontv_consume_rate_limit(p_scope text, p_subject_hash text)
returns jsonb language plpgsql security invoker
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_limit integer;
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset timestamptz;
begin
  v_limit := case p_scope
    when 'login' then 10 when 'register' then 5 when 'image-proxy' then 300
    when 'm3u8-parse' then 60 when 'm3u8-proxy' then 1200 when 'm3u8-filter' then 60
    else null end;
  if v_limit is null or p_subject_hash is null or p_subject_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid rate limit scope or subject' using errcode = '22023';
  end if;
  insert into public.moontv_rate_buckets as b (scope, subject_hash, count, reset_at)
  values (p_scope, p_subject_hash, 1, v_now + interval '1 minute')
  on conflict (scope, subject_hash) do update set
    count = case when b.reset_at <= v_now then 1 else least(b.count + 1, v_limit + 1) end,
    reset_at = case when b.reset_at <= v_now then v_now + interval '1 minute' else b.reset_at end
  returning count, reset_at into v_count, v_reset;

  -- Opportunistic bounded cleanup, not a retention SLA or a paid scheduler.
  -- Idle deployments may retain expired hashes until traffic resumes.
  if random() < 0.01 and pg_try_advisory_xact_lock(729108315) then
    delete from public.moontv_rate_buckets where (scope, subject_hash) in (
      select scope, subject_hash from public.moontv_rate_buckets
      where reset_at < v_now - interval '1 day'
      order by reset_at limit 1000 for update skip locked
    );
  end if;
  return jsonb_build_object('allowed', v_count <= v_limit,
    'remaining', greatest(0, v_limit - v_count), 'limit', v_limit,
    'reset_at_ms', floor(extract(epoch from v_reset) * 1000)::bigint);
end;
$$;
revoke all on function public.moontv_consume_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.moontv_consume_rate_limit(text, text) to service_role;
notify pgrst, 'reload schema';
commit;
