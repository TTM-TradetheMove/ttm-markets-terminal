-- Phone announcements for the other new releases (TTM Pills is in announce_pills.sql).
-- Each one opens its own page when tapped. Make sure supabase/announce.sql has been run once.
-- Audience: 'admin' = just you, 'beta' = beta testers + you, 'pro' = Pro members + you, 'all' = everyone with phone alerts on.
-- iPhone shows text only (no picture), so the plan is in the title. Android shows the picture too.

-- STEP 1: send all four to just you as a test. Run this alone first.
insert into public.ttm_announce (title, body, url, audience, image) values
 ('🏦 New (Premium): Market Makers', 'Are Wintermute and the other big market makers long or short on BTC, ETH, XRP and SOL? See their positions and big wallet moves.', './crypto/index.html#marketmakers', 'admin', 'https://ttm.markets/img/announce/market-makers.png'),
 ('📅 New (Free): Exchange holidays', 'Closures and early closes for crypto and TradFi sessions, with the reason. Upcoming holidays are in Trading Hours and the daily brief.', './crypto/index.html#tradinghours', 'admin', 'https://ttm.markets/img/announce/exchange-holidays.png'),
 ('🔍 New: TTM LENS charts', 'Full-screen live charts with drawing tools, indicators and replay. Anyone can buy a LENS pass, even on the free plan. Tap any ticker in the terminal to open it.', './crypto/index.html#ttmcharts', 'admin', 'https://ttm.markets/img/announce/ttm-lens.png'),
 ('🔀 New (Free): Hedge in the trade tracker', 'You can now hold a long and a short on the same coin at the same time. Open the Trade Tracker to try it.', './crypto/index.html#tradejournal', 'admin', 'https://ttm.markets/img/announce/hedge.png');

-- STEP 2: when the tests look right, send them to everyone with alerts on. Run this separately.
-- Market Makers is a Premium feature: change its audience to 'pro' if you only want it to reach Pro members.
-- insert into public.ttm_announce (title, body, url, audience, image) values
--  ('🏦 New (Premium): Market Makers', 'Are Wintermute and the other big market makers long or short on BTC, ETH, XRP and SOL? See their positions and big wallet moves.', './crypto/index.html#marketmakers', 'all', 'https://ttm.markets/img/announce/market-makers.png'),
--  ('📅 New (Free): Exchange holidays', 'Closures and early closes for crypto and TradFi sessions, with the reason. Upcoming holidays are in Trading Hours and the daily brief.', './crypto/index.html#tradinghours', 'all', 'https://ttm.markets/img/announce/exchange-holidays.png'),
--  ('🔍 New: TTM LENS charts', 'Full-screen live charts with drawing tools, indicators and replay. Anyone can buy a LENS pass, even on the free plan. Tap any ticker in the terminal to open it.', './crypto/index.html#ttmcharts', 'all', 'https://ttm.markets/img/announce/ttm-lens.png'),
--  ('🔀 New (Free): Hedge in the trade tracker', 'You can now hold a long and a short on the same coin at the same time. Open the Trade Tracker to try it.', './crypto/index.html#tradejournal', 'all', 'https://ttm.markets/img/announce/hedge.png');
