-- TTM Automated Trading Engine, version 1 (paper trading). Run once in the Supabase SQL editor.
-- Only admins and testers can read anything here. Only the engine-tick function (service role) writes trades.

create table if not exists public.ttm_engine_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,            -- the kill switch
  pairs text[] not null default '{BTCUSDT,ETHUSDT,SOLUSDT,FETUSDT,BIOUSDT,AVAXUSDT,ICPUSDT,APTUSDT,SEIUSDT,XLMUSDT}',
  start_balance numeric not null default 10000,
  risk_pct numeric not null default 1,               -- max % of equity risked on one trade
  max_open int not null default 3,
  max_lev numeric not null default 3,
  model text not null default 'claude-sonnet-5-5',
  last_tick timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.ttm_engine_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.ttm_engine_positions (
  id bigserial primary key,
  pair text not null,
  side text not null check (side in ('long','short')),
  entry numeric not null, units numeric not null, notional numeric not null, lev numeric not null, margin numeric not null,
  sl numeric not null, tp numeric,
  risk_usd numeric not null,
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz, exit_price numeric, pnl numeric, close_reason text,
  reason text
);
create index if not exists ttm_engine_pos_idx on public.ttm_engine_positions (status, opened_at desc);

create table if not exists public.ttm_engine_decisions (
  id bigserial primary key,
  ts timestamptz not null default now(),
  pair text, action text, price numeric,
  reason text, accepted boolean not null default false, reject_reason text,
  raw jsonb
);
create index if not exists ttm_engine_dec_idx on public.ttm_engine_decisions (ts desc);

create table if not exists public.ttm_engine_equity (
  id bigserial primary key,
  ts timestamptz not null default now(),
  equity numeric not null, cash numeric not null, unrealised numeric not null
);
create index if not exists ttm_engine_eq_idx on public.ttm_engine_equity (ts desc);

alter table public.ttm_engine_config enable row level security;
alter table public.ttm_engine_positions enable row level security;
alter table public.ttm_engine_decisions enable row level security;
alter table public.ttm_engine_equity enable row level security;

drop policy if exists p_eng_cfg_sel on public.ttm_engine_config;
create policy p_eng_cfg_sel on public.ttm_engine_config for select using (public.ttm_is_tester());
drop policy if exists p_eng_cfg_upd on public.ttm_engine_config;
create policy p_eng_cfg_upd on public.ttm_engine_config for update using (public.ttm_is_admin()) with check (public.ttm_is_admin());
drop policy if exists p_eng_pos_sel on public.ttm_engine_positions;
create policy p_eng_pos_sel on public.ttm_engine_positions for select using (public.ttm_is_tester());
drop policy if exists p_eng_dec_sel on public.ttm_engine_decisions;
create policy p_eng_dec_sel on public.ttm_engine_decisions for select using (public.ttm_is_tester());
drop policy if exists p_eng_eq_sel on public.ttm_engine_equity;
create policy p_eng_eq_sel on public.ttm_engine_equity for select using (public.ttm_is_tester());

revoke all on public.ttm_engine_config, public.ttm_engine_positions, public.ttm_engine_decisions, public.ttm_engine_equity from anon, authenticated;
grant select on public.ttm_engine_config, public.ttm_engine_positions, public.ttm_engine_decisions, public.ttm_engine_equity to authenticated;
grant update (enabled, pairs, start_balance, risk_pct, max_open, max_lev, model) on public.ttm_engine_config to authenticated;

-- Reset button for the dashboard (admin only): wipes the paper account and starts again
create or replace function public.ttm_engine_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  update public.ttm_engine_config set enabled = false, last_error = null, updated_at = now() where id = 1;
  delete from public.ttm_engine_positions; delete from public.ttm_engine_decisions; delete from public.ttm_engine_equity;
end $$;
grant execute on function public.ttm_engine_reset() to authenticated;

-- Tick (engine2.sql changes this to every 5 minutes). Replace PASTE_ENGINE_KEY below with the same text you save as the ENGINE_KEY secret, then run.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('ttm-engine-tick'); exception when others then null; end $$;
select cron.schedule('ttm-engine-tick', '2 * * * *', $$
  select net.http_post(url := 'https://zqolxnufjsseylzgfztz.supabase.co/functions/v1/engine-tick',
    headers := '{"Content-Type":"application/json","x-engine-key":"PASTE_ENGINE_KEY"}'::jsonb, body := '{}'::jsonb) $$);
