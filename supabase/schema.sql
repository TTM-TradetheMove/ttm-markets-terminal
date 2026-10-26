-- TTM accounts: run once in Supabase (SQL Editor -> New query -> paste -> Run)

create table if not exists public.ttm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free','crypto','tradfi','pro')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.ttm_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.ttm_settings (
  key text primary key,
  value jsonb not null
);

create or replace function public.ttm_is_admin() returns boolean
language sql security definer set search_path = public stable as
$$ select coalesce((select is_admin from public.ttm_profiles where id = auth.uid()), false) $$;

create or replace function public.ttm_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into public.ttm_profiles(id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
drop trigger if exists ttm_on_signup on auth.users;
create trigger ttm_on_signup after insert on auth.users for each row execute function public.ttm_new_user();

alter table public.ttm_profiles  enable row level security;
alter table public.ttm_user_data enable row level security;
alter table public.ttm_settings  enable row level security;

drop policy if exists p_prof_sel on public.ttm_profiles;
create policy p_prof_sel on public.ttm_profiles for select using (id = auth.uid() or public.ttm_is_admin());
drop policy if exists p_prof_upd on public.ttm_profiles;
create policy p_prof_upd on public.ttm_profiles for update using (public.ttm_is_admin()) with check (public.ttm_is_admin());

drop policy if exists p_data_all on public.ttm_user_data;
create policy p_data_all on public.ttm_user_data for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists p_set_sel on public.ttm_settings;
create policy p_set_sel on public.ttm_settings for select using (true);
drop policy if exists p_set_all on public.ttm_settings;
create policy p_set_all on public.ttm_settings for all using (public.ttm_is_admin()) with check (public.ttm_is_admin());

insert into public.ttm_settings(key, value) values
  ('charging', 'false'::jsonb),
  ('wall', 'false'::jsonb)
on conflict (key) do nothing;
-- (the per-section access grid is created from the Admin page on first save)

-- After you sign in once on the site, make yourself the admin (change the email):
-- update public.ttm_profiles set is_admin = true where email = 'you@example.com';
