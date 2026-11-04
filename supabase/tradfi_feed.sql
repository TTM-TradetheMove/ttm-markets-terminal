-- TradFi spot moves use the same feed as crypto spot. This only adds a label so the phone alert says "(TradFi Spot)".
-- Safe to run more than once.
alter table public.ttm_spot_feed add column if not exists market text not null default 'crypto';
