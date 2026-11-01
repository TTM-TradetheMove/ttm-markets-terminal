-- Alerts a member's own trades send to their own phone (TP hit, SL hit, SL moved). Safe to run more than once.
create table if not exists public.ttm_my_alerts (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  ukey    text not null,
  title   text not null,
  body    text,
  ts      timestamptz not null default now(),
  pushed  boolean not null default false,
  unique (user_id, ukey)
);
alter table public.ttm_my_alerts enable row level security;
drop policy if exists p_ma_sel on public.ttm_my_alerts;
create policy p_ma_sel on public.ttm_my_alerts for select using (user_id = auth.uid());
drop policy if exists p_ma_ins on public.ttm_my_alerts;
create policy p_ma_ins on public.ttm_my_alerts for insert with check (user_id = auth.uid());
revoke all on public.ttm_my_alerts from anon, authenticated;
grant select, insert on public.ttm_my_alerts to authenticated;
do $$ begin perform cron.unschedule('ttm-my-alerts-clean'); exception when others then null; end $$;
select cron.schedule('ttm-my-alerts-clean', '17 3 * * *', $$ delete from public.ttm_my_alerts where ts < now() - interval '30 days' $$);
