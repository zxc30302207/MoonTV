create table if not exists public.moontv_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists moontv_kv_key_prefix_idx
  on public.moontv_kv (key text_pattern_ops);

alter table public.moontv_kv enable row level security;

comment on table public.moontv_kv is
  'MoonTV server-side KV storage. Access this table with the Supabase service role key only.';
