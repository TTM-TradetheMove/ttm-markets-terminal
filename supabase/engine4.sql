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
