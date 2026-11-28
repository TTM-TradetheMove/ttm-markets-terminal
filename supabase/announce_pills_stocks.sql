-- Phone announcement: TTM Pills now has US and ASX stocks. Tapping it opens Pills on the US stocks view.
-- Audience: 'admin' = just you (test first), 'all' = everyone with phone alerts on.
-- Send after the site has deployed and the stock data job has run at least once.

-- STEP 1: test on just yourself. Run this alone first.
insert into public.ttm_announce (title, body, url, audience, image) values
 ('💊 TTM PILLS now has stocks (free)', 'Top US and ASX stocks as live pills, biggest gainers on top, biggest losers at the bottom. US is near-live, ASX is delayed 20 min. Tap to open.', './pills/?m=us', 'admin', 'https://ttm.markets/img/announce/ttm-pills.png');

-- STEP 2: when the test opens the stock view, send to everyone with alerts on. Run this separately, once.
-- insert into public.ttm_announce (title, body, url, audience, image) values
--  ('💊 TTM PILLS now has stocks (free)', 'Top US and ASX stocks as live pills, biggest gainers on top, biggest losers at the bottom. US is near-live, ASX is delayed 20 min. Tap to open.', './pills/?m=us', 'all', 'https://ttm.markets/img/announce/ttm-pills.png');
