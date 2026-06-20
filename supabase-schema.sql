create extension if not exists pgcrypto;

create table if not exists public.defensoria_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  identity jsonb not null,
  objective_answers jsonb not null,
  subjective_answers jsonb not null,
  objective_score integer not null,
  objective_total integer not null,
  performance_percent numeric(5,2) not null,
  status text not null default 'Em analise',
  admin_note text not null default '',
  ai_risk_average integer not null,
  ai_flagged_count integer not null,
  ai_high_risk_count integer not null,
  ai_provider text not null default 'groq',
  ai_model text,
  ai_raw jsonb
);

create index if not exists defensoria_submissions_created_at_idx
  on public.defensoria_submissions (created_at desc);

create index if not exists defensoria_submissions_ai_risk_idx
  on public.defensoria_submissions (ai_risk_average desc);

create unique index if not exists defensoria_submissions_discord_unique_idx
  on public.defensoria_submissions (lower(identity->>'discord'));

create unique index if not exists defensoria_submissions_roblox_unique_idx
  on public.defensoria_submissions (lower(identity->>'roblox'));

alter table public.defensoria_submissions
  add column if not exists status text not null default 'Em analise',
  add column if not exists admin_note text not null default '',
  add column if not exists status_history jsonb not null default '[]'::jsonb,
  add column if not exists seed text,
  add column if not exists started_at timestamptz,
  add column if not exists similarity_summary jsonb,
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists ip_hash text,
  add column if not exists ua_hash text,
  add column if not exists paste_count integer not null default 0,
  add column if not exists reviewer text,
  add column if not exists fingerprint text,
  add column if not exists devtools_opened boolean not null default false,
  add column if not exists review_count integer not null default 0,
  add column if not exists max_idle_ms bigint not null default 0,
  add column if not exists auto_suggested_status text,
  add column if not exists manual_grade numeric(4,1),
  add column if not exists manual_grade_note text not null default '';

create table if not exists public.defensoria_config (
  id integer primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.defensoria_config (id, data)
  values (1, '{}'::jsonb)
  on conflict (id) do nothing;

alter table public.defensoria_config enable row level security;

drop policy if exists "No public access to defensoria config" on public.defensoria_config;
create policy "No public access to defensoria config"
  on public.defensoria_config
  for all
  using (false)
  with check (false);

create table if not exists public.defensoria_magic_links (
  token_hash text primary key,
  expires_at timestamptz not null,
  used boolean not null default false
);

-- Log de auditoria das acoes administrativas.
create table if not exists public.defensoria_audit (
  id uuid primary key,
  at timestamptz not null default now(),
  action text not null,
  actor text,
  target text,
  meta jsonb,
  ip_hash text
);
create index if not exists defensoria_audit_at_idx on public.defensoria_audit (at desc);
alter table public.defensoria_audit enable row level security;
drop policy if exists "No public access to defensoria audit" on public.defensoria_audit;
create policy "No public access to defensoria audit"
  on public.defensoria_audit for all using (false) with check (false);

-- Presenca: candidatos preenchendo agora (heartbeat).
create table if not exists public.defensoria_presence (
  client_id text primary key,
  last_seen timestamptz not null default now()
);
create index if not exists defensoria_presence_last_seen_idx on public.defensoria_presence (last_seen desc);
alter table public.defensoria_presence enable row level security;
drop policy if exists "No public access to defensoria presence" on public.defensoria_presence;
create policy "No public access to defensoria presence"
  on public.defensoria_presence for all using (false) with check (false);

-- Rascunhos salvos no servidor (sincroniza entre dispositivos).
create table if not exists public.defensoria_drafts (
  client_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.defensoria_drafts enable row level security;
drop policy if exists "No public access to defensoria drafts" on public.defensoria_drafts;
create policy "No public access to defensoria drafts"
  on public.defensoria_drafts for all using (false) with check (false);

alter table public.defensoria_submissions enable row level security;

drop policy if exists "No public access to defensoria submissions" on public.defensoria_submissions;
create policy "No public access to defensoria submissions"
  on public.defensoria_submissions
  for all
  using (false)
  with check (false);

-- O backend usa SUPABASE_SERVICE_ROLE_KEY, que ignora RLS com seguranca no servidor.
