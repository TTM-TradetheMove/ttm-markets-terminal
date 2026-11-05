-- TTM Automated Trading Engine: time frame choice, strategies, trailing stops, 5 minute schedule.
-- Run once in the Supabase SQL editor AFTER engine.sql. Safe to run again. Run this BEFORE redeploying engine-tick.
alter table public.ttm_engine_config add column if not exists timeframe text not null default '1H';
alter table public.ttm_engine_config add column if not exists strategies text[] not null default '{trend,breakout,sweep,momentum}';
alter table public.ttm_engine_config add column if not exists last_agent timestamptz;
alter table public.ttm_engine_config drop constraint if exists ttm_engine_tf_chk;
alter table public.ttm_engine_config add constraint ttm_engine_tf_chk check (timeframe in ('5m','15m','30m','1H','2H','4H','8H','12H','1D','3D','1W'));
alter table public.ttm_engine_positions add column if not exists strategy text;
alter table public.ttm_engine_positions add column if not exists trail_atr numeric;
alter table public.ttm_engine_decisions add column if not exists strategy text;
alter table public.ttm_engine_decisions add column if not exists timeframe text;
grant update (timeframe, strategies) on public.ttm_engine_config to authenticated;

create or replace function public.ttm_engine_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  update public.ttm_engine_config set enabled = false, last_error = null, last_agent = null, updated_at = now() where id = 1;
  delete from public.ttm_engine_positions; delete from public.ttm_engine_decisions; delete from public.ttm_engine_equity;
end $$;
grant execute on function public.ttm_engine_reset() to authenticated;

-- the schedule now runs every 5 minutes (it only asks the AI when a new candle of your time frame has closed)
do $$ begin
  perform cron.alter_job((select jobid from cron.job where jobname = 'ttm-engine-tick'), schedule := '*/5 * * * *');
exception when others then raise notice 'Could not change the schedule: %', sqlerrm; end $$;
select jobname, schedule from cron.job where jobname = 'ttm-engine-tick';
-- TTM Agent Review: the agent reviews its own closed trades and suggests improvements. Run once in the Supabase SQL editor AFTER engine2.sql.
-- Safe to run again. Run this BEFORE redeploying engine-tick.
create table if not exists public.ttm_engine_reviews (
  id bigserial primary key,
  ts timestamptz not null default now(),
  trades_reviewed int not null default 0,
  summary text,
  model text
);
create table if not exists public.ttm_engine_suggestions (
  id bigserial primary key,
  review_id bigint references public.ttm_engine_reviews(id) on delete cascade,
  ts timestamptz not null default now(),
  title text not null,
  detail text,
  kind text not null default 'lesson' check (kind in ('change','lesson')),
  change jsonb,
  status text not null default 'new' check (status in ('new','approved','dismissed')),
  decided_at timestamptz
);
create index if not exists ttm_engine_sug_idx on public.ttm_engine_suggestions (status, ts desc);
alter table public.ttm_engine_reviews enable row level security;
alter table public.ttm_engine_suggestions enable row level security;
drop policy if exists p_eng_rev_sel on public.ttm_engine_reviews;
create policy p_eng_rev_sel on public.ttm_engine_reviews for select using (public.ttm_is_tester());
drop policy if exists p_eng_sug_sel on public.ttm_engine_suggestions;
create policy p_eng_sug_sel on public.ttm_engine_suggestions for select using (public.ttm_is_tester());
drop policy if exists p_eng_sug_upd on public.ttm_engine_suggestions;
create policy p_eng_sug_upd on public.ttm_engine_suggestions for update using (public.ttm_is_admin()) with check (public.ttm_is_admin());
revoke all on public.ttm_engine_reviews, public.ttm_engine_suggestions from anon, authenticated;
grant select on public.ttm_engine_reviews, public.ttm_engine_suggestions to authenticated;
grant update (status, decided_at) on public.ttm_engine_suggestions to authenticated;
grant usage, select on all sequences in schema public to service_role;

-- Reset also clears the reviews and suggestions
create or replace function public.ttm_engine_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  update public.ttm_engine_config set enabled = false, last_error = null, last_agent = null, updated_at = now() where id = 1;
  delete from public.ttm_engine_positions; delete from public.ttm_engine_decisions; delete from public.ttm_engine_equity;
  delete from public.ttm_engine_suggestions; delete from public.ttm_engine_reviews;
end $$;
grant execute on function public.ttm_engine_reset() to authenticated;
-- TTM Agent: "go ahead" or "needs my approval" mode. Run once in the Supabase SQL editor AFTER engine2.sql and engine3.sql.
-- Safe to run again. Run this BEFORE redeploying engine-tick.
alter table public.ttm_engine_config add column if not exists mode text not null default 'auto';
alter table public.ttm_engine_config drop constraint if exists ttm_engine_mode_chk;
alter table public.ttm_engine_config add constraint ttm_engine_mode_chk check (mode in ('auto','approval'));
grant update (mode) on public.ttm_engine_config to authenticated;

create table if not exists public.ttm_engine_proposals (
  id bigserial primary key,
  ts timestamptz not null default now(),
  expires_at timestamptz not null,
  pair text not null,
  side text not null check (side in ('long','short')),
  strategy text, timeframe text,
  price numeric not null, sl numeric not null, tp numeric, lev numeric, trail_atr numeric,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  decided_at timestamptz, result text
);
create index if not exists ttm_engine_prop_idx on public.ttm_engine_proposals (status, ts desc);
alter table public.ttm_engine_proposals enable row level security;
drop policy if exists p_eng_prop_sel on public.ttm_engine_proposals;
create policy p_eng_prop_sel on public.ttm_engine_proposals for select using (public.ttm_is_tester());
drop policy if exists p_eng_prop_upd on public.ttm_engine_proposals;
create policy p_eng_prop_upd on public.ttm_engine_proposals for update using (public.ttm_is_admin()) with check (public.ttm_is_admin());
revoke all on public.ttm_engine_proposals from anon, authenticated;
grant select on public.ttm_engine_proposals to authenticated;
grant update (status, decided_at, result) on public.ttm_engine_proposals to authenticated;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.ttm_engine_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  update public.ttm_engine_config set enabled = false, last_error = null, last_agent = null, updated_at = now() where id = 1;
  delete from public.ttm_engine_positions; delete from public.ttm_engine_decisions; delete from public.ttm_engine_equity;
  delete from public.ttm_engine_suggestions; delete from public.ttm_engine_reviews; delete from public.ttm_engine_proposals;
end $$;
grant execute on function public.ttm_engine_reset() to authenticated;

-- Pairs: "my list" or "auto scan the busiest Bitget markets and trade what is moving"
alter table public.ttm_engine_config add column if not exists pair_mode text not null default 'list';
alter table public.ttm_engine_config add column if not exists scan_top int not null default 50;
alter table public.ttm_engine_config add column if not exists scan_pick int not null default 8;
alter table public.ttm_engine_config drop constraint if exists ttm_engine_pairmode_chk;
alter table public.ttm_engine_config add constraint ttm_engine_pairmode_chk check (pair_mode in ('list','auto'));
grant update (pair_mode, scan_top, scan_pick) on public.ttm_engine_config to authenticated;
-- Changing the starting balance now shifts the whole equity history, so Equity moves and the Result (profit or loss) stays the same.
-- Run once in the Supabase SQL editor. Safe to run again.
create or replace function public.ttm_engine_set_balance(new_balance numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old numeric;
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  if new_balance is null or new_balance < 100 then raise exception 'balance must be at least 100'; end if;
  select start_balance into old from public.ttm_engine_config where id = 1;
  update public.ttm_engine_config set start_balance = new_balance, updated_at = now() where id = 1;
  update public.ttm_engine_equity set equity = equity + (new_balance - old), cash = cash + (new_balance - old);
end $$;
grant execute on function public.ttm_engine_set_balance(numeric) to authenticated;
-- Auto time frame: the agent can move to a better time frame when the current one is not working (and sends you an alert).
-- Run once in the Supabase SQL editor. Safe to run again.
alter table public.ttm_engine_config add column if not exists auto_tf boolean not null default false;
alter table public.ttm_engine_config add column if not exists tf_allowed text[] not null default '{15m,30m,1H,2H,4H,8H,12H}';
alter table public.ttm_engine_config add column if not exists tf_changed_at timestamptz;
alter table public.ttm_engine_positions add column if not exists timeframe text;
grant update (auto_tf, tf_allowed) on public.ttm_engine_config to authenticated;
-- Time frame mode (I choose / agent switches when results are poor / agent picks per trade) and crypto-only trading.
-- Run once in the Supabase SQL editor. Safe to run again.
alter table public.ttm_engine_config add column if not exists tf_mode text not null default 'manual';
alter table public.ttm_engine_config add column if not exists crypto_only boolean not null default false;
update public.ttm_engine_config set tf_mode = 'agent' where auto_tf = true and tf_mode = 'manual';
grant update (tf_mode, crypto_only) on public.ttm_engine_config to authenticated;
-- the engine stores the latest price on each open trade, so the dashboard can show live profit
alter table public.ttm_engine_positions add column if not exists last_price numeric;
alter table public.ttm_engine_positions add column if not exists last_price_at timestamptz;
