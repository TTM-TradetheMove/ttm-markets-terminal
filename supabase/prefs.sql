-- Member alert settings. Safe to run more than once.
create table if not exists public.ttm_prefs (
  user_id uuid primary key default auth.uid(),
  prefs   jsonb not null default '{}'::jsonb,
  updated timestamptz not null default now()
);
alter table public.ttm_prefs enable row level security;
drop policy if exists p_pf_sel on public.ttm_prefs;
create policy p_pf_sel on public.ttm_prefs for select using (user_id = auth.uid());
drop policy if exists p_pf_ins on public.ttm_prefs;
create policy p_pf_ins on public.ttm_prefs for insert with check (user_id = auth.uid());
drop policy if exists p_pf_upd on public.ttm_prefs;
create policy p_pf_upd on public.ttm_prefs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.ttm_prefs from anon, authenticated;
grant select, insert, update on public.ttm_prefs to authenticated;
