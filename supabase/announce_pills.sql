-- Phone announcement for TTM Pills. Tapping it opens TTM Pills (./pills/).
-- Audience: 'admin' = just you (test first), 'beta' = beta testers + you, 'pro' = Pro members + you, 'all' = everyone with phone alerts on.
-- Make sure supabase/announce.sql has been run once (it creates ttm_announce).

-- STEP 1: test it on just yourself. Run this alone first.
insert into public.ttm_announce (title, body, url, audience, image) values
 ('💊 New: TTM Pills (free)', 'Every crypto coin as a live pill. Biggest gainers on top, biggest losers at the bottom. Tap to open, and add it to your Home Screen as an app.', './pills/', 'admin', 'https://ttm.markets/promo/ttm_offer_x.png');

-- STEP 2: when the test looks right, send to everyone with alerts on. Run this separately.
-- insert into public.ttm_announce (title, body, url, audience, image) values
--  ('💊 New: TTM Pills (free)', 'Every crypto coin as a live pill. Biggest gainers on top, biggest losers at the bottom. Tap to open, and add it to your Home Screen as an app.', './pills/', 'all', 'https://ttm.markets/promo/ttm_offer_x.png');
