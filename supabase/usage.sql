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

-- One call that returns every number the Usage page shows (admins only).
create or replace function public.ttm_usage_summary(p_since timestamptz default '-infinity', p_tz text default 'UTC')
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare r jsonb;
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  with raw as (select * from public.ttm_events where ts >= p_since),
       bad as (select vid from raw group by vid having count(*) > 4000 or count(distinct sid) > 100),
       e as (select * from raw where vid not in (select vid from bad))
  select jsonb_build_object(
    'ignored', (select count(*) from bad),
    'kpi', (select jsonb_build_object('events', count(*), 'visitors', count(distinct vid), 'sessions', count(distinct sid),
              'members', count(distinct uid), 'views', count(*) filter (where ev = 'view'),
              'first', min(ts), 'last', max(ts)) from e),
    'avg_dur', (select round(avg((p->>'dur')::numeric)) from e where ev = 'end' and (p->>'dur') ~ '^[0-9]+$'),
    'returning', (select count(*) from (select vid from e where ev = 'start' group by vid
                  having max(case when (p->>'n') ~ '^[0-9]+$' then (p->>'n')::int else 1 end) > 1) x),
    'daily', (select coalesce(jsonb_agg(d order by day), '[]') from (
                select (ts at time zone p_tz)::date as day, count(distinct vid) as visitors, count(distinct sid) as sessions,
                       count(*) filter (where ev = 'view') as views from e group by 1) d),
    'sections', (select coalesce(jsonb_agg(s order by views desc), '[]') from (
                select v.tg, v.views, v.visitors, round(d.avg_s) as avg_s from
                  (select tg, count(*) as views, count(distinct vid) as visitors from e where ev = 'view' and tg is not null group by tg) v
                  left join (select tg, avg((p->>'s')::numeric) as avg_s from e where ev = 'dwell' and (p->>'s') ~ '^[0-9]+$' group by tg) d using (tg)
                  order by v.views desc limit 40) s),
    'clicks', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'click' and tg is not null
                group by tg order by n desc limit 40) c),
    'features', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'feat' and tg is not null
                group by tg order by n desc limit 30) c),
    'locks', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n, count(distinct vid) as visitors from e where ev = 'lock' and tg is not null
                group by tg order by n desc limit 30) c),
    'choices', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select tg, count(*) as n from e where ev = 'choice' and tg is not null
                group by tg order by n desc limit 50) c),
    'devices', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(dv, 'unknown') as tg, count(distinct sid) as n from e where ev = 'start' group by 1) c),
    'referrers', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(nullif(p->>'ref', ''), 'direct') as tg, count(distinct sid) as n from e where ev = 'start'
                group by 1 order by n desc limit 15) c),
    'zones', (select coalesce(jsonb_agg(c order by n desc), '[]') from (
                select coalesce(nullif(p->>'tz', ''), 'unknown') as tg, count(distinct vid) as n from e where ev = 'start'
                group by 1 order by n desc limit 15) c),
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
revoke all on function public.ttm_usage_summary(timestamptz, text) from public, anon;
grant execute on function public.ttm_usage_summary(timestamptz, text) to authenticated;
