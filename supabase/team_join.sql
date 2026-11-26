-- Run in Supabase > SQL editor. Safe to run again: the "already a member" step only happens the first time.
-- 1) Team tick box (like Beta testers)
alter table public.ttm_profiles add column if not exists team boolean not null default false;

-- 2) New-member phone alert: the first time only, mark everyone who is already a member as "alerted" so only NEW sign-ups ping you
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ttm_profiles' and column_name = 'join_alerted') then
    alter table public.ttm_profiles add column join_alerted boolean not null default false;
    update public.ttm_profiles set join_alerted = true;
  end if;
end $$;
