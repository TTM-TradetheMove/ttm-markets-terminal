-- One-off phone announcements. Insert a row and the minute-by-minute tick in push-spot sends it once.
-- audience: 'beta' (beta testers + admin, default), 'admin' (just you), 'pro' (Pro members + you), 'all' (everyone with alerts on)
create table if not exists public.ttm_announce (
  id bigserial primary key,
  title text not null,
  body text,
  url text,
  audience text not null default 'beta',
  image text,
  sent boolean not null default false,
  sent_to int,
  created_at timestamptz not null default now()
);
alter table public.ttm_announce enable row level security;   -- no policies: only the service role (push-spot) can touch it

-- Announce the new Property Cycle page to beta testers
insert into public.ttm_announce (title, body, url, audience) values
 ('🏠 New BETA: 18-year Property Cycle', 'House prices for the US, AU, UK, CA, NZ, DE and JP back to the 1970s, with the 18-year land cycle on top. Open TradFi > Property Cycle.', './tradfi/index.html#propertycycle', 'beta');

-- Big picture on the push (Android shows it under the text; iPhone ignores it). Safe to run more than once.
alter table public.ttm_announce add column if not exists image text;

-- Announce Ask TTM Agent. STEP 1: send it to just you as a test. Run this alone first.
insert into public.ttm_announce (title, body, url, audience, image) values
 ('📈 New: Ask TTM Agent', 'Your trading coach is in the terminal. See what is working, what is costing you, and how to improve. Open the Trade Tracker and tap Ask TTM Agent.', './crypto/index.html#tradejournal', 'admin', 'https://ttm.markets/img/announce/ask-ttm-agent.png');

-- STEP 2: when the test looks right, send to everyone with alerts on. Run this separately.
-- (Change 'all' to 'pro' if you only want Pro members and yourself.)
-- insert into public.ttm_announce (title, body, url, audience, image) values
--  ('📈 New: Ask TTM Agent', 'Your trading coach is in the terminal. See what is working, what is costing you, and how to improve. Open the Trade Tracker and tap Ask TTM Agent.', './crypto/index.html#tradejournal', 'all', 'https://ttm.markets/img/announce/ask-ttm-agent.png');
