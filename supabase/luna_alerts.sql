-- Luna Cycle phase starts: members with the Luna Cycles beta get a push 7 days before each one.
create table if not exists public.ttm_luna_alerts (
  id        bigint generated always as identity primary key,
  starts_at timestamptz not null unique,
  name      text not null,
  color     text not null check (color in ('red','green')),
  notified  boolean not null default false
);
alter table public.ttm_luna_alerts enable row level security;
revoke all on public.ttm_luna_alerts from anon, authenticated;
insert into public.ttm_luna_alerts (starts_at, name, color) values
('2028-12-31 12:00+00', 'Lunar Cycle', 'red'),
  ('2030-06-15 12:00+00', 'Solar Cycle', 'green'),
  ('2032-04-25 12:00+00', 'Lunar Cycle', 'red'),
  ('2033-10-08 12:00+00', 'Solar Cycle', 'green'),
  ('2036-02-11 12:00+00', 'Lunar Cycle', 'red'),
  ('2037-07-27 12:00+00', 'Solar Cycle', 'green')
on conflict (starts_at) do nothing;
