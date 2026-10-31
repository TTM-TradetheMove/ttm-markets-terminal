-- TTM: Telegram name on accounts + beta tester feedback. Safe to run more than once.

-- 1. Telegram name on each profile (people set it through a function, never directly)
alter table public.ttm_profiles add column if not exists tg_handle text;

create or replace function public.ttm_set_tg(p_handle text) returns void
language sql security definer set search_path = public as $$
  update public.ttm_profiles
     set tg_handle = nullif(left(regexp_replace(coalesce(p_handle,''), '[^A-Za-z0-9_]', '', 'g'), 32), '')
   where id = auth.uid();
$$;
grant execute on function public.ttm_set_tg(text) to authenticated;

-- 2. Beta testers (profiles with beta = true) and admins
alter table public.ttm_profiles add column if not exists beta boolean not null default false;

create or replace function public.ttm_is_tester() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select beta or is_admin from public.ttm_profiles where id = auth.uid()), false)
$$;
grant execute on function public.ttm_is_tester() to authenticated;

-- 3. Feedback from beta sections: message, read tick and reply from you
create table if not exists public.ttm_feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  section     text not null,
  who         text,
  message     text not null check (char_length(message) between 1 and 4000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  reply       text,
  replied_at  timestamptz
);
create index if not exists ttm_feedback_section_idx on public.ttm_feedback (section, created_at);
alter table public.ttm_feedback enable row level security;

drop policy if exists p_fb_sel on public.ttm_feedback;
create policy p_fb_sel on public.ttm_feedback for select
  using (user_id = auth.uid() or public.ttm_is_tester());
drop policy if exists p_fb_ins on public.ttm_feedback;
create policy p_fb_ins on public.ttm_feedback for insert
  with check (user_id = auth.uid() and public.ttm_is_tester());
drop policy if exists p_fb_upd on public.ttm_feedback;
create policy p_fb_upd on public.ttm_feedback for update
  using (public.ttm_is_admin()) with check (public.ttm_is_admin());
drop policy if exists p_fb_del on public.ttm_feedback;
create policy p_fb_del on public.ttm_feedback for delete
  using (public.ttm_is_admin());

grant select, insert, update, delete on public.ttm_feedback to authenticated;
