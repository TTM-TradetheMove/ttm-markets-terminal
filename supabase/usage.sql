-- TTM usage analytics. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- (Run schema.sql first.) Stores anonymous usage events: which pages and buttons are used and how often.
-- It never stores what people type (prices, balances, tokens) and no IP address is saved in this table.

create table if not exists public.ttm_events (
  id  bigint generated always as identity primary key,
  ts  timestamptz not null default now(),
  vid text not null,            -- anonymous random id kept in the visitor's browser
  sid text not null,            -- one id per visit
  uid uuid,                     -- signed-in member, null when anonymous
  pg  text,                     -- home / crypto / tradfi
  ev  text not null,            -- start, end, view, dwell, click, choice, feat, lock, error, auth_*
  tg  text,                     -- what: section, button, feature
  dv  text,                     -- mobile / tablet / desktop
  p   jsonb not null default '{}'::jsonb
);
create index if not exists ttm_events_ts_idx  on public.ttm_events (ts);
create index if not exists ttm_events_ev_idx  on public.ttm_events (ev, ts);
create index if not exists ttm_events_uid_idx on public.ttm_events (uid, ts) where uid is not null;

alter table public.ttm_events enable row level security;

create or replace function public.ttm_track_on() returns boolean
language sql security definer set search_path = public stable as
$$ select coalesce((select value <> 'false'::jsonb from public.ttm_settings where key = 'track'), true) $$;
grant execute on function public.ttm_track_on() to anon, authenticated;

-- Firewall 1: only well-formed events from the site are accepted (fixed event names, ids, sizes).
drop policy if exists ev_insert on public.ttm_events;
create policy ev_insert on public.ttm_events for insert to anon, authenticated
  with check (
    public.ttm_track_on()
    and ev in ('start','end','view','dwell','click','choice','feat','lock','error','auth_open','auth_sent','auth_ok')
    and pg in ('home','crypto','tradfi')
    and (dv is null or dv in ('mobile','tablet','desktop'))
    and vid ~ '^[a-z0-9]{8,32}$' and sid ~ '^[a-z0-9]{8,32}$'
    and coalesce(length(tg), 0) <= 110 and (tg is null or tg !~ '[[:cntrl:]]')
    and jsonb_typeof(p) = 'object' and pg_column_size(p) < 1000
    and (ev <> 'dwell' or ((p->>'s') ~ '^[0-9]{1,4}$'))
    and (ev <> 'end'   or ((p->>'dur') ~ '^[0-9]{1,6}$'))
    and (uid is null or uid = auth.uid())
  );
drop policy if exists ev_select on public.ttm_events;
create policy ev_select on public.ttm_events for select to authenticated using (public.ttm_is_admin());
drop policy if exists ev_delete on public.ttm_events;
create policy ev_delete on public.ttm_events for delete to authenticated using (public.ttm_is_admin());

grant insert on public.ttm_events to anon, authenticated;
grant select, delete on public.ttm_events to authenticated;

-- Firewall 2: blocks scripts and floods. Counts per minute (per network address, per browser, and overall) in a small
-- table that is cleared automatically. The address is only used as a one-way hash for that count; it is never stored with the events.
create table if not exists public.ttm_rate (k text not null, w timestamptz not null, n int not null default 0, primary key (k, w));
alter table public.ttm_rate enable row level security;   -- no policies: nobody can read it through the API

create or replace function public.ttm_events_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_h json; v_ip text; v_ua text; v_n int; v_win timestamptz := date_trunc('minute', now()); v_key text; v_lim int;
begin
  begin v_h := nullif(current_setting('request.headers', true), '')::json; exception when others then v_h := null; end;
  v_ua := lower(coalesce(v_h->>'user-agent', ''));
  if v_ua ~ '(bot|crawl|spider|headless|curl/|wget|python|scrapy|httpclient|postman|java/|go-http|node-fetch|axios|libwww|phantom|selenium)' then
    raise exception 'blocked' using errcode = '42501';
  end if;
  v_ip := trim(split_part(coalesce(v_h->>'cf-connecting-ip', v_h->>'x-forwarded-for', v_h->>'x-real-ip', 'unknown'), ',', 1));
  for v_key, v_lim in select * from (values ('ip:' || md5(v_ip || current_date::text), 300), ('vid:' || new.vid, 120), ('all', 2500)) as t(a, b) loop
    insert into public.ttm_rate as r (k, w, n) values (v_key, v_win, 1)
      on conflict (k, w) do update set n = r.n + 1 returning r.n into v_n;
    if v_n > v_lim then raise exception 'rate limit' using errcode = '42501'; end if;
  end loop;
  if random() < 0.01 then delete from public.ttm_rate where w < now() - interval '2 hours'; end if;
  return new;
end $$;
drop trigger if exists ttm_events_guard on public.ttm_events;
create trigger ttm_events_guard before insert on public.ttm_events for each row execute function public.ttm_events_guard();

-- Reports for the Insights page (admins only). One window = everything the page shows for a period.
drop function if exists public.ttm_usage_summary(timestamptz, text);

create or replace function public.ttm_usage_block(p_from timestamptz, p_to timestamptz, p_tz text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare r jsonb; v_hour boolean := p_from > '-infinity' and (p_to - p_from) <= interval '2 days';
begin
  with raw as (select * from public.ttm_events where ts >= p_from and ts < p_to),
       bad as (select vid from raw group by vid having count(*) > 4000 or count(distinct sid) > 100),
       e as (select * from raw where vid not in (select vid from bad))
  select jsonb_build_object(
    'ignored', (select count(*) from bad),
    'hourly', v_hour,
    'kpi', (select jsonb_build_object('events', count(*), 'visitors', count(distinct vid), 'sessions', count(distinct sid),
              'members', count(distinct uid), 'views', count(*) filter (where ev = 'view'),
              'first', min(ts), 'last', max(ts)) from e),
    'avg_dur', (select round(avg((p->>'dur')::numeric)) from e where ev = 'end' and (p->>'dur') ~ '^[0-9]+$'),
    'returning', (select count(*) from (select vid from e where ev = 'start' group by vid
                  having max(case when (p->>'n') ~ '^[0-9]+$' then (p->>'n')::int else 1 end) > 1) x),
    'daily', (select coalesce(jsonb_agg(d order by day), '[]') from (
                select case when v_hour then to_char(date_trunc('hour', ts at time zone p_tz), 'YYYY-MM-DD"T"HH24')
                            else to_char((ts at time zone p_tz)::date, 'YYYY-MM-DD') end as day,
                       count(distinct vid) as visitors, count(distinct sid) as sessions,
                       count(*) filter (where ev = 'view') as views, count(*) filter (where ev in ('click','feat')) as actions
                from e group by 1) d),
    'sections', (select coalesce(jsonb_agg(s order by views desc), '[]') from (
                select v.tg, v.views, v.visitors, round(d.avg_s) as avg_s from
                  (select tg, count(*) as views, count(distinct vid) as visitors from e where ev = 'view' and tg is not null group by tg) v
                  left join (select tg, avg((p->>'s')::numeric) as avg_s from e where ev = 'dwell' and (p->>'s') ~ '^[0-9]+$' group by tg) d using (tg)
                  order by v.views desc limit 80) s),
    'clicks', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'click' and tg is not null
                group by tg order by n desc limit 60) c),
    'features', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'feat' and tg is not null
                group by tg order by n desc limit 40) c),
    'locks', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'lock' and tg is not null
                group by tg order by n desc limit 30) c),
    'choices', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n from e where ev = 'choice' and tg is not null group by tg order by n desc limit 80) c),
    'devices', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(dv, 'unknown') as tg, count(distinct vid) as n from e where ev = 'start' group by 1) c),
    'referrers', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(nullif(p->>'ref', ''), 'direct') as tg, count(distinct sid) as n from e where ev = 'start'
                group by 1 order by n desc limit 15) c),
    'zones', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(nullif(p->>'tz', ''), 'unknown') as tg, count(distinct vid) as n, count(distinct sid) as visits
                from e where ev = 'start' group by 1 order by n desc limit 80) c),
    'hours', (select coalesce(jsonb_agg(c), '[]') from (
                select extract(dow from ts at time zone p_tz)::int as dow, extract(hour from ts at time zone p_tz)::int as hr,
                       count(distinct sid) as n from e where ev = 'start' group by 1, 2) c),
    'funnel', (select jsonb_build_object(
                'visitors', count(distinct vid) filter (where ev = 'start'),
                'auth_open', count(distinct vid) filter (where ev = 'auth_open'),
                'auth_sent', count(distinct vid) filter (where ev = 'auth_sent'),
                'auth_ok', count(distinct vid) filter (where ev = 'auth_ok'),
                'lock_seen', count(distinct vid) filter (where ev = 'lock')) from e),
    'errors', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'error' and tg is not null
                group by tg order by n desc limit 10) c),
    'members', (select coalesce(jsonb_agg(m order by last desc), '[]') from (
                select pr.email, pr.plan, count(distinct e.sid) as sessions, count(*) as events, max(e.ts) as last,
                       (select e2.tg from e e2 where e2.uid = e.uid and e2.ev = 'view' and e2.tg is not null
                          group by e2.tg order by count(*) desc limit 1) as top
                from e join public.ttm_profiles pr on pr.id = e.uid group by pr.email, pr.plan, e.uid
                order by max(e.ts) desc limit 200) m)
  ) into r;
  return r;
end $$;
revoke all on function public.ttm_usage_block(timestamptz, timestamptz, text) from public, anon, authenticated;

-- Current period and the period before it (p_days null = all time, no comparison).
create or replace function public.ttm_usage_report(p_days int default null, p_tz text default 'UTC')
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_now timestamptz := now() + interval '1 minute';
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  if p_days is null then
    return jsonb_build_object('days', null, 'cur', public.ttm_usage_block('-infinity', v_now, p_tz), 'prev', null, 'generated', now());
  end if;
  return jsonb_build_object('days', p_days, 'generated', now(),
    'cur',  public.ttm_usage_block(now() - make_interval(days => p_days), v_now, p_tz),
    'prev', public.ttm_usage_block(now() - make_interval(days => 2 * p_days), now() - make_interval(days => p_days), p_tz));
end $$;
revoke all on function public.ttm_usage_report(int, text) from public, anon;
grant execute on function public.ttm_usage_report(int, text) to authenticated;

-- Drill-down for one item (a section, button or feature): trend, devices, places, times, and what those visitors did next.
create or replace function public.ttm_usage_detail(p_ev text, p_tg text, p_days int default 30, p_tz text default 'UTC')
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare r jsonb; v_since timestamptz := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  with w as (select * from public.ttm_events where ts >= v_since and ev = p_ev and tg = p_tg),
       s as (select distinct sid from w),
       o as (select ev, tg, vid from public.ttm_events where ts >= v_since and sid in (select sid from s) and ev in ('view','click','feat','lock')
             and not (ev = p_ev and tg = p_tg))
  select jsonb_build_object(
    'total', (select count(*) from w), 'people', (select count(distinct vid) from w),
    'daily', (select coalesce(jsonb_agg(d order by day), '[]') from (
                select to_char((ts at time zone p_tz)::date, 'YYYY-MM-DD') as day, count(*) as n, count(distinct vid) as people from w group by 1) d),
    'devices', (select coalesce(jsonb_agg(c order by n desc), '[]') from (select coalesce(dv, 'unknown') as tg, count(distinct vid) as n from w group by 1) c),
    'zones', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(nullif(st.p->>'tz', ''), 'unknown') as tg, count(distinct st.vid) as n
                from public.ttm_events st where st.ev = 'start' and st.sid in (select sid from s) and st.ts >= v_since group by 1 order by n desc limit 20) c),
    'hours', (select coalesce(jsonb_agg(c), '[]') from (
                select extract(dow from ts at time zone p_tz)::int as dow, extract(hour from ts at time zone p_tz)::int as hr, count(*) as n from w group by 1, 2) c),
    'next', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select ev, tg, count(*) as n, count(distinct vid) as people from o group by ev, tg order by n desc limit 14) c)
  ) into r;
  return r;
end $$;
revoke all on function public.ttm_usage_detail(text, text, int, text) from public, anon;
grant execute on function public.ttm_usage_detail(text, text, int, text) to authenticated;
