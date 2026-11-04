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
