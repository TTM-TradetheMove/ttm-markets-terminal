-- Phone announcement: five new crypto tools (Stablecoins and Dominance, Cycle Overlay, TTM Risk Metric, Pair Risk, Whale Moves).
-- Tapping it opens the Stablecoins and Dominance page, which is free for everyone.
-- Audience: 'admin' = just you (test first), 'all' = everyone with phone alerts on.
-- Send after the site has deployed. Check the tiers in Admin match the What's new badges first
-- (Stablecoins Free, Cycle Overlay Premium, TTM Risk Metric Premium, Pair Risk Pro, Whale Moves Premium).

-- STEP 1: test on just yourself. Run this alone first.
insert into public.ttm_announce (title, body, url, audience) values
 ('🆕 5 new crypto tools in TTM', 'Cycle Overlay, TTM Risk Metric, Pair Risk, Stablecoins and Dominance, and Whale Moves. Tap to open, more under Crypto.', './crypto/index.html#stabledom', 'admin');

-- STEP 2: when the test looks right, send to everyone with alerts on. Run this separately, once.
-- insert into public.ttm_announce (title, body, url, audience) values
--  ('🆕 5 new crypto tools in TTM', 'Cycle Overlay, TTM Risk Metric, Pair Risk, Stablecoins and Dominance, and Whale Moves. Tap to open, more under Crypto.', './crypto/index.html#stabledom', 'all');
