-- Alert health check. Supabase -> SQL Editor -> New query -> paste ONE block at a time -> Run. Nothing here changes data.

-- 1. Is the once-a-minute tick running? Expect jobs "ttm-live-tick" active = true.
select jobname, schedule, active from cron.job order by jobname;

-- 2. Did the last runs succeed? Expect status = succeeded and a recent start_time (within the last minute or two).
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
order by d.start_time desc limit 10;

-- 3. Your live (Zoom) sessions. reminded = true means the 15 minute push was claimed; live_sent = true means "live now" was claimed.
select id, title, starts_at, reminded, announced,
       (select 'live_sent' from information_schema.columns where table_name = 'ttm_live' and column_name = 'live_sent') as has_live_now_column
from public.ttm_live order by starts_at desc limit 8;

-- 4. Phone subscriptions. If this is 0, nobody can receive a push. Each phone/browser must press "Turn on phone alerts" once.
select count(*) as subscriptions, count(distinct user_id) as people from public.ttm_push_subs;

-- 5. Chart/drawing alerts sent from the chart. pushed = false for old rows means the database webhook on ttm_my_alerts is missing.
select id, ukey, title, pushed, ts from public.ttm_my_alerts order by ts desc limit 10;

-- 6. Market-session alerts already sent (one row each)
select * from public.ttm_session_fired order by 1 desc limit 10;

-- 7. Who has switched alert types off (live is on for everyone unless false; session alerts only go to people whose setting is saved as true)
select count(*) filter (where prefs->>'live' = 'false') as live_off,
       count(*) filter (where prefs->>'s_warn' = 'true') as session_warn_on,
       count(*) as people_with_saved_settings
from public.ttm_prefs;
