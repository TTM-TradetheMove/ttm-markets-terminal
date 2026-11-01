-- TTM messaging: private Pro chat, live sessions, phone alerts for every member.
-- Safe to run more than once. Run the whole thing in the Supabase SQL editor.

-- 1) Phone alerts: any signed-in member can save their phone (was Pro only)
drop policy if exists p_ps_all on public.ttm_push_subs;
create policy p_ps_all on public.ttm_push_subs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Spot feed: remember which moves were already pushed to phones
alter table public.ttm_spot_feed add column if not exists pushed boolean not null default false;

-- 3) Private chat (one conversation per member, Pro members only)
create table if not exists public.ttm_chat (
  id         bigint generated always as identity primary key,
  member_id  uuid not null,
  from_admin boolean not null default false,
  body       text not null check (char_length(body) between 1 and 2000),
  ts         timestamptz not null default now(),
  seen       boolean not null default false,
  pushed     boolean not null default false
);
create index if not exists ttm_chat_member_idx on public.ttm_chat (member_id, ts desc);
alter table public.ttm_chat enable row level security;
drop policy if exists p_ch_sel on public.ttm_chat;
create policy p_ch_sel on public.ttm_chat for select using (member_id = auth.uid() or public.ttm_is_admin());
drop policy if exists p_ch_ins on public.ttm_chat;
create policy p_ch_ins on public.ttm_chat for insert with check (
  (member_id = auth.uid() and from_admin = false and public.ttm_is_pro()) or (public.ttm_is_admin() and from_admin = true));
drop policy if exists p_ch_upd on public.ttm_chat;
create policy p_ch_upd on public.ttm_chat for update
  using ((member_id = auth.uid() and from_admin = true) or (public.ttm_is_admin() and from_admin = false));
drop policy if exists p_ch_del on public.ttm_chat;
create policy p_ch_del on public.ttm_chat for delete using (public.ttm_is_admin());
revoke all on public.ttm_chat from anon, authenticated;
grant select, insert, delete on public.ttm_chat to authenticated;
grant update (seen) on public.ttm_chat to authenticated;

-- 4) Live sessions (Zoom)
create table if not exists public.ttm_live (
  id        bigint generated always as identity primary key,
  title     text not null,
  starts_at timestamptz not null,
  zoom_url  text not null,
  note      text,
  announced boolean not null default false,
  reminded  boolean not null default false,
  created   timestamptz not null default now()
);
alter table public.ttm_live enable row level security;
drop policy if exists p_lv_sel on public.ttm_live;
create policy p_lv_sel on public.ttm_live for select to authenticated using (true);
drop policy if exists p_lv_ins on public.ttm_live;
create policy p_lv_ins on public.ttm_live for insert with check (public.ttm_is_admin());
drop policy if exists p_lv_upd on public.ttm_live;
create policy p_lv_upd on public.ttm_live for update using (public.ttm_is_admin());
drop policy if exists p_lv_del on public.ttm_live;
create policy p_lv_del on public.ttm_live for delete using (public.ttm_is_admin());
grant select, insert, update, delete on public.ttm_live to authenticated;

-- 5) A tick every minute so live sessions are announced and reminded on time
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('ttm-live-tick'); exception when others then null; end $$;
select cron.schedule('ttm-live-tick', '* * * * *', $$
  select net.http_post(url := 'https://zqolxnufjsseylzgfztz.supabase.co/functions/v1/push-spot',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"table":"cron"}'::jsonb) $$);
