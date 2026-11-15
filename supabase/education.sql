-- TTM Education: video lessons, each set to Free, Premium or Pro. Run once in the Supabase SQL editor (safe to run again).
-- Members can list lessons (title, text, plan needed) but can NEVER read the video id directly: it is only handed over by
-- ttm_lesson_video() when their plan is high enough. Admins add/edit lessons from the Education page itself.

create table if not exists public.ttm_lessons (
  id bigint generated always as identity primary key,
  title text not null,
  descr text,
  category text not null default 'General',
  provider text not null default 'youtube' check (provider in ('youtube', 'stream')),
  vid text not null,
  min_tier text not null default 'free' check (min_tier in ('free', 'premium', 'pro')),
  sort int not null default 100,
  duration text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ttm_lessons enable row level security;
drop policy if exists p_les_sel on public.ttm_lessons;
create policy p_les_sel on public.ttm_lessons for select to authenticated using (published or public.ttm_is_admin());
drop policy if exists p_les_ins on public.ttm_lessons;
create policy p_les_ins on public.ttm_lessons for insert to authenticated with check (public.ttm_is_admin());
drop policy if exists p_les_upd on public.ttm_lessons;
create policy p_les_upd on public.ttm_lessons for update to authenticated using (public.ttm_is_admin()) with check (public.ttm_is_admin());
drop policy if exists p_les_del on public.ttm_lessons;
create policy p_les_del on public.ttm_lessons for delete to authenticated using (public.ttm_is_admin());

revoke all on public.ttm_lessons from anon, authenticated;
grant select (id, title, descr, category, provider, min_tier, sort, duration, published, created_at) on public.ttm_lessons to authenticated;
grant insert, update, delete on public.ttm_lessons to authenticated;

-- plan level of whoever is asking: admin = 2, Pro = 2, Premium = 1, Free or expired = 0
create or replace function public.ttm_my_tier() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when is_admin then 2
                               when plan_until is null or plan_until > now() then public.ttm_tier(plan)
                               else 0 end
                   from public.ttm_profiles where id = auth.uid()), 0)
$$;
grant execute on function public.ttm_my_tier() to authenticated;

-- the only way to get a video: handed over only if the member's plan is high enough
create or replace function public.ttm_lesson_video(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and (published or public.ttm_is_admin()) and public.ttm_my_tier() >= public.ttm_tier(min_tier)
              then jsonb_build_object('provider', provider, 'vid', vid) else null end
  from public.ttm_lessons where id = p_id
$$;
grant execute on function public.ttm_lesson_video(bigint) to authenticated;
