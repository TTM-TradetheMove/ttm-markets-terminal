-- SEND TO ALL MEMBERS: five phone announcements, one per new release.
-- 'all' = everyone with phone alerts on. Each opens its own page when tapped.
-- Run the test versions first (announce_pills.sql and announce_whatsnew.sql send to just you).
-- WARNING: running this sends straight away and cannot be unsent. Run it once only.
-- iPhone shows text only (no picture), so the plan is in each title. Android shows the picture too.
insert into public.ttm_announce (title, body, url, audience, image) values
 ('💊 TTM PILLS is live (free)', 'Every crypto coin as a live pill. Biggest gainers on top, biggest losers at the bottom. Tap to open, and add it to your Home Screen as an app.', './pills/', 'all', 'https://ttm.markets/img/announce/ttm-pills.png'),
 ('🏦 New (Premium): Market Makers', 'Are Wintermute and the other big market makers long or short on BTC, ETH, XRP and SOL? See their positions and big wallet moves.', './crypto/index.html#marketmakers', 'all', 'https://ttm.markets/img/announce/market-makers.png'),
 ('📅 New (Free): Exchange holidays', 'Closures and early closes for crypto and TradFi sessions, with the reason. Upcoming holidays are in Trading Hours and the daily brief.', './crypto/index.html#tradinghours', 'all', 'https://ttm.markets/img/announce/exchange-holidays.png'),
 ('🔍 New: TTM LENS charts', 'Full-screen live charts with drawing tools, indicators and replay. Anyone can buy a LENS pass, even on the free plan. Tap any ticker in the terminal to open it.', './crypto/index.html#ttmcharts', 'all', 'https://ttm.markets/img/announce/ttm-lens.png'),
 ('🔀 New (Free): Hedge in the trade tracker', 'You can now hold a long and a short on the same coin at the same time. Open the Trade Tracker to try it.', './crypto/index.html#tradejournal', 'all', 'https://ttm.markets/img/announce/hedge.png');
