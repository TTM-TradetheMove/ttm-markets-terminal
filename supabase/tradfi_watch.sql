-- TTM TradFi order watcher: collects limit orders and books take profits for TradFi SPOT orders placed in TTM LENS, with the app closed.
-- 1) Deploy the edge function "tradfi-watch" (supabase/functions/tradfi-watch/index.ts) with Verify JWT OFF. It uses the ENGINE_KEY secret you already set for engine-tick.
-- 2) Replace PASTE_ENGINE_KEY below with the same text as that ENGINE_KEY secret, then run this once in the SQL editor. Safe to run again.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('ttm-tradfi-watch'); exception when others then null; end $$;
select cron.schedule('ttm-tradfi-watch', '*/5 * * * *', $$
  select net.http_post(url := 'https://zqolxnufjsseylzgfztz.supabase.co/functions/v1/tradfi-watch',
    headers := '{"Content-Type":"application/json","x-engine-key":"PASTE_ENGINE_KEY"}'::jsonb, body := '{}'::jsonb) $$);
select jobname, schedule, active from cron.job where jobname = 'ttm-tradfi-watch';
