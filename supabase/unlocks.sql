-- Token unlock tracker (beta). Safe to run more than once.
create table if not exists public.ttm_unlocks (
  id         bigint generated always as identity primary key,
  token      text not null,
  name       text not null default '',
  unlock_at  timestamptz not null,
  amount     numeric,            -- tokens unlocking
  pct        numeric,            -- % of total supply
  kind       text not null default '',   -- team, investors, ecosystem, ...
  note       text not null default '',
  link       text not null default '',
  alerted7   boolean not null default false,
  alerted1   boolean not null default false,
  created    timestamptz not null default now()
);
create index if not exists ttm_unlocks_at_idx on public.ttm_unlocks (unlock_at);
alter table public.ttm_unlocks enable row level security;
drop policy if exists p_un_sel on public.ttm_unlocks;
create policy p_un_sel on public.ttm_unlocks for select to authenticated using (public.ttm_is_tester());
drop policy if exists p_un_ins on public.ttm_unlocks;
create policy p_un_ins on public.ttm_unlocks for insert to authenticated with check (public.ttm_is_admin());
drop policy if exists p_un_upd on public.ttm_unlocks;
create policy p_un_upd on public.ttm_unlocks for update to authenticated using (public.ttm_is_admin()) with check (public.ttm_is_admin());
drop policy if exists p_un_del on public.ttm_unlocks;
create policy p_un_del on public.ttm_unlocks for delete to authenticated using (public.ttm_is_admin());
revoke all on public.ttm_unlocks from anon, authenticated;
grant select, insert, update, delete on public.ttm_unlocks to authenticated;
