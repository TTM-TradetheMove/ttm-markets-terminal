-- TTM LENS paper trading + competitions. Run once in Supabase > SQL editor.

create table if not exists public.ttm_paper_comps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  start_balance numeric not null default 10000,
  max_leverage numeric not null default 10,
  fee_pct numeric not null default 0.06,
  max_open int not null default 5,
  markets text not null default 'both',      -- spot | perp | both
  status text not null default 'open',       -- open | closed
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ttm_paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  comp_id uuid references public.ttm_paper_comps(id) on delete cascade,   -- null = personal account
  name text not null default 'Paper account',
  handle text not null default '',
  start_balance numeric not null default 10000,
  max_leverage numeric not null default 20,
  fee_pct numeric not null default 0.06,
  max_open int not null default 0,           -- 0 = no limit
  markets text not null default 'both',
  balance numeric not null default 10000,    -- start + realised P/L
  equity numeric not null default 10000,     -- balance + open P/L (updated by the player's app)
  trades int not null default 0,
  wins int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ttm_paper_one_per_comp on public.ttm_paper_accounts (user_id, comp_id) where comp_id is not null;

create table if not exists public.ttm_paper_trades (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ttm_paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sym text not null,
  mkt text not null default 'perp',
  side text not null,                         -- long | short
  lev numeric not null default 1,
  margin numeric not null,
  qty numeric not null,
  entry numeric not null,
  sl numeric,
  tp numeric,
  status text not null default 'open',        -- open | closed
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit numeric,
  pnl numeric,
  reason text
);
create index if not exists ttm_paper_trades_acc on public.ttm_paper_trades (account_id, status);

alter table public.ttm_paper_comps enable row level security;
alter table public.ttm_paper_accounts enable row level security;
alter table public.ttm_paper_trades enable row level security;

-- competitions: everyone signed in can read; only admins create / change
drop policy if exists paper_comps_read on public.ttm_paper_comps;
create policy paper_comps_read on public.ttm_paper_comps for select to authenticated using (true);
drop policy if exists paper_comps_admin on public.ttm_paper_comps;
create policy paper_comps_admin on public.ttm_paper_comps for all to authenticated
  using (exists (select 1 from public.ttm_profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.ttm_profiles p where p.id = auth.uid() and p.is_admin));

-- accounts: you manage your own; competition accounts are readable by everyone (leaderboard)
drop policy if exists paper_acc_read on public.ttm_paper_accounts;
create policy paper_acc_read on public.ttm_paper_accounts for select to authenticated using (user_id = auth.uid() or comp_id is not null);
drop policy if exists paper_acc_write on public.ttm_paper_accounts;
create policy paper_acc_write on public.ttm_paper_accounts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- trades: only the owner (admins can read everything)
drop policy if exists paper_tr_own on public.ttm_paper_trades;
create policy paper_tr_own on public.ttm_paper_trades for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists paper_tr_admin on public.ttm_paper_trades;
create policy paper_tr_admin on public.ttm_paper_trades for select to authenticated
  using (exists (select 1 from public.ttm_profiles p where p.id = auth.uid() and p.is_admin));

grant select, insert, update, delete on public.ttm_paper_comps, public.ttm_paper_accounts, public.ttm_paper_trades to authenticated;
