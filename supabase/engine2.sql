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
