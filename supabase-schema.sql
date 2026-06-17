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
  add column if not exists admin_note text not null default '';

alter table public.defensoria_submissions enable row level security;

drop policy if exists "No public access to defensoria submissions" on public.defensoria_submissions;
create policy "No public access to defensoria submissions"
  on public.defensoria_submissions
  for all
  using (false)
  with check (false);

-- O backend usa SUPABASE_SERVICE_ROLE_KEY, que ignora RLS com seguranca no servidor.
