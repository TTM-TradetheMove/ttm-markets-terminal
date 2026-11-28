-- Phone announcement: TradFi Risk Charts now open to Premium. Tapping it opens the TradFi Risk Charts page.
-- Audience: 'admin' = just you (test first), 'pro' = Pro members + you, 'all' = everyone with phone alerts on.
-- Premium members and above can open it, so the best audience is 'all' (free members who tap it see the upgrade prompt).

-- STEP 1: test on just yourself. Run this alone first.
insert into public.ttm_announce (title, body, url, audience) values
 ('📉 TradFi Risk Charts are live (Premium)', 'Liquidity, credit spreads, the yield curve, jobs, production, GDP and VIX, each scored for risk. Now open to Premium members. Tap to open.', './tradfi/index.html#riskcharts', 'admin');

-- STEP 2: when the test looks right, send to everyone with alerts on. Run this separately, once.
-- insert into public.ttm_announce (title, body, url, audience) values
--  ('📉 TradFi Risk Charts are live (Premium)', 'Liquidity, credit spreads, the yield curve, jobs, production, GDP and VIX, each scored for risk. Now open to Premium members. Tap to open.', './tradfi/index.html#riskcharts', 'all');
