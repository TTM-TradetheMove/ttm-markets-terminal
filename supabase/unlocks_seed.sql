-- Token unlocks seed, November 2026. Safe to run more than once (skips any token + date already listed).
-- Dates come from published unlock calendars (Tokenomist-based). Times are not published, so each is set to 00:00 UTC.
-- Sizes are projections where noted. Check the source link on each row before relying on it.

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'KITE', 'Kite', '2026-11-03 00:00+00', 640000000, 17.41, 'team & investors', '1-year cliff ends: team and advisors 400M, investors 240M. Tokenomist projection; one report shows a 300M VC tranche only.', 'https://www.kucoin.com/news/flash/three-major-token-unlocks-to-watch-in-first-week-of-november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'KITE' and unlock_at::date = '2026-11-03');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'HYPE', 'Hyperliquid', '2026-11-06 00:00+00', 180000, 0.08, 'core contributors', 'Team-committed amount. The vesting model projects up to about 9.92M, so treat the size as unconfirmed.', 'https://www.kucoin.com/news/flash/three-major-token-unlocks-to-watch-in-first-week-of-november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'HYPE' and unlock_at::date = '2026-11-06');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'JTO', 'Jito', '2026-11-07 00:00+00', null, null, '', 'About $4.1M in the weekly report. Token amount not published there.', 'https://www.tokenpost.com/news/investing/46375'
where not exists (select 1 from public.ttm_unlocks where token = 'JTO' and unlock_at::date = '2026-11-07');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'AVAX', 'Avalanche', '2026-11-08 00:00+00', null, null, '', 'About $14.3M. Token amount not confirmed.', 'https://coinalertnews.com/news/2026/10/30/hyperliquid-november-token-unlocks'
where not exists (select 1 from public.ttm_unlocks where token = 'AVAX' and unlock_at::date = '2026-11-08');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'ALLO', 'Allora', '2026-11-11 00:00+00', 160000000, null, 'cliff', '160M ALLO cliff unlock. Single source.', 'https://cryptolaxy.com/unlocks/november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'ALLO' and unlock_at::date = '2026-11-11');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'PIEVERSE', 'Pieverse', '2026-11-14 00:00+00', null, null, 'team & investors', '12-month lockup ends. Single source, size not published.', 'https://cryptolaxy.com/unlocks/november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'PIEVERSE' and unlock_at::date = '2026-11-14');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'CRO', 'Cronos', '2026-11-16 00:00+00', null, null, '', 'About $60M. Token amount not confirmed.', 'https://coinalertnews.com/news/2026/10/30/hyperliquid-november-token-unlocks'
where not exists (select 1 from public.ttm_unlocks where token = 'CRO' and unlock_at::date = '2026-11-16');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'ZRO', 'LayerZero', '2026-11-20 00:00+00', null, null, '', 'About $38.9M. Token amount not confirmed.', 'https://coinalertnews.com/news/2026/10/30/hyperliquid-november-token-unlocks'
where not exists (select 1 from public.ttm_unlocks where token = 'ZRO' and unlock_at::date = '2026-11-20');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'MON', 'Monad', '2026-11-24 00:00+00', 16800000000, null, '', '16.8B MON, about $131.9M. Two sources agree.', 'https://cryptolaxy.com/unlocks/november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'MON' and unlock_at::date = '2026-11-24');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'HUMA', 'Huma Finance', '2026-11-26 00:00+00', null, null, 'team & investors', 'First unlock. Single source, size not published.', 'https://cryptolaxy.com/unlocks/november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'HUMA' and unlock_at::date = '2026-11-26');

insert into public.ttm_unlocks (token, name, unlock_at, amount, pct, kind, note, link)
select 'KNTQ', 'Kinetiq', '2026-11-27 00:00+00', null, null, 'core contributors & investors', 'Cliff ends. Single source, size not published.', 'https://cryptolaxy.com/unlocks/november-2026'
where not exists (select 1 from public.ttm_unlocks where token = 'KNTQ' and unlock_at::date = '2026-11-27');
