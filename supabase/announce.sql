-- One-off phone announcements. Insert a row and the minute-by-minute tick in push-spot sends it once.
-- audience: 'beta' (beta testers + admin, default), 'admin' (just you), 'all' (everyone with alerts on)
create table if not exists public.ttm_announce (
  id bigserial primary key,
  title text not null,
  body text,
  url text,
  audience text not null default 'beta',
  sent boolean not null default false,
  sent_to int,
  created_at timestamptz not null default now()
);
alter table public.ttm_announce enable row level security;   -- no policies: only the service role (push-spot) can touch it

-- Announce the new Property Cycle page to beta testers
insert into public.ttm_announce (title, body, url, audience) values
 ('🏠 New BETA: 18-year Property Cycle', 'House prices for the US, AU, UK, CA, NZ, DE and JP back to the 1970s, with the 18-year land cycle on top. Open TradFi > Property Cycle.', './tradfi/index.html#propertycycle', 'beta');
