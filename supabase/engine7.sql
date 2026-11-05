-- Time frame mode (I choose / agent switches when results are poor / agent picks per trade) and crypto-only trading.
-- Run once in the Supabase SQL editor. Safe to run again.
alter table public.ttm_engine_config add column if not exists tf_mode text not null default 'manual';
alter table public.ttm_engine_config add column if not exists crypto_only boolean not null default false;
update public.ttm_engine_config set tf_mode = 'agent' where auto_tf = true and tf_mode = 'manual';
grant update (tf_mode, crypto_only) on public.ttm_engine_config to authenticated;
-- the engine stores the latest price on each open trade, so the dashboard can show live profit
alter table public.ttm_engine_positions add column if not exists last_price numeric;
alter table public.ttm_engine_positions add column if not exists last_price_at timestamptz;
