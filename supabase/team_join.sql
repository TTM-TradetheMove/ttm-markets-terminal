-- Run once in Supabase > SQL editor.
-- 1) Team tick box (like Beta testers)
alter table public.ttm_profiles add column if not exists team boolean not null default false;

-- 2) New-member phone alert: mark everyone who is already a member as "alerted" so only NEW sign-ups ping you
alter table public.ttm_profiles add column if not exists join_alerted boolean not null default false;
update public.ttm_profiles set join_alerted = true where join_alerted = false;
