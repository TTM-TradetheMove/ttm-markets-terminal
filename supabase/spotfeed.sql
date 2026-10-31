-- TTM spot moves feed: Pro members see new moves straight away, everyone else after 14 days.
-- Only an admin can add rows. Safe to run more than once.
create table if not exists public.ttm_spot_feed (
  id      bigint generated always as identity primary key,
  ukey    text unique,
  ts      timestamptz not null default now(),
  kind    text not null,
  asset   text not null,
  title   text not null,
  body    text,
  pct     numeric
);
create index if not exists ttm_spot_feed_ts_idx on public.ttm_spot_feed (ts desc);
alter table public.ttm_spot_feed enable row level security;

create or replace function public.ttm_is_pro() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or (plan = 'pro' and (plan_until is null or plan_until > now()))
                   from public.ttm_profiles where id = auth.uid()), false)
$$;
grant execute on function public.ttm_is_pro() to authenticated, anon;

drop policy if exists p_sf_sel on public.ttm_spot_feed;
create policy p_sf_sel on public.ttm_spot_feed for select
  using (ts < now() - interval '14 days' or public.ttm_is_pro());
drop policy if exists p_sf_ins on public.ttm_spot_feed;
create policy p_sf_ins on public.ttm_spot_feed for insert with check (public.ttm_is_admin());
drop policy if exists p_sf_del on public.ttm_spot_feed;
create policy p_sf_del on public.ttm_spot_feed for delete using (public.ttm_is_admin());

grant select on public.ttm_spot_feed to anon, authenticated;
grant insert, delete on public.ttm_spot_feed to authenticated;
