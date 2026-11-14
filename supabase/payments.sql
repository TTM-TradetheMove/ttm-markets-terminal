-- TTM: USDT (TRC20) payments, subscriptions that expire, sales, and paid-only referrals.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again (it never resets your prices or sale).
-- Needs trials.sql to have been run before (plan_until / plan_note columns).

-- 1) Prices, deposit address and the current sale, in one row you edit from Admin -> Billing.
create table if not exists public.ttm_billing (
  id text primary key default 'main',
  cfg jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.ttm_billing (id, cfg) values ('main',
  '{"premium":19.95,"pro":65,"year_months":10,"address":"TQ9jFWj43xJC1QM5tAnsDHV1fLnhCfF5Yi","order_minutes":60,"sale":{"on":false,"name":"","pct":0,"starts":null,"ends":null}}'::jsonb)
  on conflict (id) do nothing;
alter table public.ttm_billing enable row level security;
drop policy if exists billing_read on public.ttm_billing;
create policy billing_read on public.ttm_billing for select using (true);
drop policy if exists billing_admin on public.ttm_billing;
create policy billing_admin on public.ttm_billing for all using (public.ttm_is_admin()) with check (public.ttm_is_admin());

-- 2) Orders: one per "Pay with USDT" click. The amount is unique per open order so we know who paid.
create table if not exists public.ttm_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('premium','pro','lens')),
  term text not null check (term in ('month','year')),
  list_price numeric(12,2) not null,
  amount numeric(12,2) not null,
  status text not null default 'open' check (status in ('open','paid','expired','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  txid text unique,
  paid_at timestamptz,
  note text
);
do $$ begin alter table public.ttm_orders drop constraint if exists ttm_orders_plan_check; alter table public.ttm_orders add constraint ttm_orders_plan_check check (plan in ('premium','pro','lens')); exception when others then null; end $$;
create index if not exists ttm_orders_open on public.ttm_orders (status, amount);
alter table public.ttm_orders enable row level security;
drop policy if exists orders_read on public.ttm_orders;
create policy orders_read on public.ttm_orders for select using (user_id = auth.uid() or public.ttm_is_admin());

-- 3) Every USDT deposit the checker sees at your address (matched or not).
create table if not exists public.ttm_payments (
  txid text primary key,
  from_addr text,
  amount numeric(18,6) not null,
  tx_time timestamptz not null,
  status text not null default 'unmatched' check (status in ('applied','unmatched','assigned','ignored')),
  order_id uuid,
  user_id uuid,
  note text,
  seen_at timestamptz not null default now()
);
alter table public.ttm_payments enable row level security;
drop policy if exists payments_admin on public.ttm_payments;
create policy payments_admin on public.ttm_payments for select using (public.ttm_is_admin());

-- 4) Price for a plan and term, with any running sale applied. Yearly = monthly x year_months (2 months free). Never above list.
create or replace function public.ttm_price(p_plan text, p_term text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; base numeric; pct numeric := 0; ends timestamptz; starts timestamptz; mp text;
begin
  select cfg into c from public.ttm_billing where id = 'main';
  if p_plan = 'lens' then   -- LENS pass: yearly, never on sale. Premium and Pro members get their own lower price.
    select plan into mp from public.ttm_profiles where id = auth.uid() and plan in ('premium','pro') and (plan_until is null or plan_until > now());
    return case mp when 'pro' then coalesce((c ->> 'lens_price_pro')::numeric, 200) when 'premium' then coalesce((c ->> 'lens_price_premium')::numeric, 350) else coalesce((c ->> 'lens_price')::numeric, 500) end;
  end if;
  base := (c ->> p_plan)::numeric;
  if base is null then raise exception 'unknown plan'; end if;
  if p_term = 'year' then base := base * coalesce((c ->> 'year_months')::numeric, 10); end if;
  if coalesce((c #>> '{sale,on}')::boolean, false) then
    ends := nullif(c #>> '{sale,ends}', '')::timestamptz;
    starts := nullif(c #>> '{sale,starts}', '')::timestamptz;
    if (starts is null or starts <= now()) and (ends is null or ends > now()) then pct := least(90, greatest(0, coalesce((c #>> '{sale,pct}')::numeric, 0))); end if;
  end if;
  return round(base * (1 - pct / 100), 2);
end $$;
grant execute on function public.ttm_price(text, text) to anon, authenticated;

-- 5) Member starts a payment. Returns the order with its exact amount (list price minus 0-99 cents, never above list).
create or replace function public.ttm_new_order(p_plan text, p_term text) returns public.ttm_orders
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lp numeric; k int; amt numeric; o public.ttm_orders; mins int;
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_plan not in ('premium','pro','lens') or p_term not in ('month','year') or (p_plan = 'lens' and p_term <> 'year') then raise exception 'unknown plan'; end if;
  update public.ttm_orders set status = 'expired' where status = 'open' and expires_at < now();
  -- membership cap: new paying members are refused once the cap is reached; people who are already paying (or paid before) can always renew
  if p_plan in ('premium','pro') and (select count(*) from public.ttm_profiles where plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%') >= coalesce((select (cfg ->> 'member_cap')::int from public.ttm_billing where id = 'main'), 350)
     and not exists (select 1 from public.ttm_orders where user_id = uid and status = 'paid' and plan in ('premium','pro'))
     and not exists (select 1 from public.ttm_profiles where id = uid and plan in ('premium','pro') and plan_until > now()) then
    raise exception 'Memberships are full right now. Message TTM on Telegram to join the waiting list.';
  end if;
  lp := public.ttm_price(p_plan, p_term);
  select * into o from public.ttm_orders where user_id = uid and status = 'open' and plan = p_plan and term = p_term and list_price = lp limit 1;
  if found then return o; end if;
  update public.ttm_orders set status = 'cancelled' where user_id = uid and status = 'open';
  for k in 0..99 loop
    amt := lp - k / 100.0;
    exit when amt <= 0;
    if not exists (select 1 from public.ttm_orders where status = 'open' and amount = amt) then
      select coalesce((cfg ->> 'order_minutes')::int, 60) into mins from public.ttm_billing where id = 'main';
      insert into public.ttm_orders (user_id, plan, term, list_price, amount, expires_at)
        values (uid, p_plan, p_term, lp, amt, now() + make_interval(mins => mins)) returning * into o;
      return o;
    end if;
  end loop;
  raise exception 'busy, try again in a minute';
end $$;
grant execute on function public.ttm_new_order(text, text) to authenticated;

-- 6) Give someone paid time. If they are already on that plan, the new period is added after their current end date.
create or replace function public.ttm_tier(p text) returns int language sql immutable as $$ select case p when 'pro' then 2 when 'premium' then 1 else 0 end $$;

create or replace function public.ttm_extend_n(p_user uuid, p_plan text, p_months int, p_note text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare cur record; start_at timestamptz; new_until timestamptz; rem interval;
begin
  select plan, plan_until, ref_grant_plan, ref_base_plan, ref_base_remaining into cur from public.ttm_profiles where id = p_user for update;
  if not found then raise exception 'no such member'; end if;
  if cur.ref_grant_plan is not null then
    -- They are on a free referral grant: their paid time is paused. Add the new time to the paused balance.
    rem := case when cur.ref_base_plan = p_plan then coalesce(cur.ref_base_remaining, interval '0') else interval '0' end + make_interval(months => p_months);
    update public.ttm_profiles set ref_base_plan = p_plan, ref_base_remaining = rem where id = p_user;
    if public.ttm_tier(p_plan) > public.ttm_tier(cur.ref_grant_plan) then
      update public.ttm_profiles set plan = p_plan, plan_until = now() + rem, plan_note = p_note, ref_grant_plan = null, ref_grant_until = null, ref_base_plan = null, ref_base_remaining = null where id = p_user;
    end if;
    return now() + rem;
  end if;
  start_at := case when cur.plan = p_plan and cur.plan_until is not null and cur.plan_until > now() then cur.plan_until else now() end;
  new_until := start_at + make_interval(months => p_months);
  update public.ttm_profiles set plan = p_plan, plan_until = new_until, plan_note = p_note where id = p_user;
  return new_until;
end $$;
revoke all on function public.ttm_extend_n(uuid, text, int, text) from public, anon, authenticated;

create or replace function public.ttm_extend(p_user uuid, p_plan text, p_term text, p_note text) returns timestamptz
language sql security definer set search_path = public as $$
  select public.ttm_extend_n(p_user, p_plan, case when p_term = 'year' then 12 else 1 end, p_note) $$;
revoke all on function public.ttm_extend(uuid, text, text, text) from public, anon, authenticated;

-- 6b) Referrals (paid members only).
--  * A referred member counts while they hold an ACTIVE PAID plan (paid in USDT, not a gift).
--  * Referrer with 4 active paid referrals: free Premium while those 4 stay. If all 4 are on Pro: free Pro.
--    The moment one drops out (their plan lapses) or drops down from Pro, the count falls by 1 and the free tier ends or steps down.
--  * While a free tier is running, the referrer's own paid time is PAUSED and given back afterwards, so nothing they paid for is lost.
--  * Referrer already on Pro whose referrals are on Premium: no tier gain, so they get time instead: 1 month (monthly referrals) or 6 months (yearly).
alter table public.ttm_profiles add column if not exists ref_code text;
alter table public.ttm_profiles add column if not exists referred_by uuid;
alter table public.ttm_profiles add column if not exists ref_paid boolean not null default false;
alter table public.ttm_profiles add column if not exists ref_paid_at timestamptz;
alter table public.ttm_profiles add column if not exists ref_plan text;
alter table public.ttm_profiles add column if not exists ref_term text;
alter table public.ttm_profiles add column if not exists ref_rewarded boolean not null default false;
alter table public.ttm_profiles add column if not exists ref_earned int not null default 0;
alter table public.ttm_profiles add column if not exists ref_grant_plan text;
alter table public.ttm_profiles add column if not exists ref_grant_until timestamptz;
alter table public.ttm_profiles add column if not exists ref_base_plan text;
alter table public.ttm_profiles add column if not exists ref_base_remaining interval;
create unique index if not exists ttm_profiles_ref_code on public.ttm_profiles (ref_code);

-- Re-work one referrer's free tier from what their referred members hold right now.
create or replace function public.ttm_ref_recalc(p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me record; n_all int; n_pro int; gp text; gu timestamptz; in_grant boolean; own_plan text; own_rem interval; own_tier int; want boolean;
begin
  select * into me from public.ttm_profiles where id = p_ref for update;
  if not found or me.is_admin then return; end if;
  in_grant := me.ref_grant_plan is not null;
  -- an admin changed their plan by hand while a grant was running: forget the grant, respect the admin
  if in_grant and me.plan not in (me.ref_grant_plan, 'free') then
    update public.ttm_profiles set ref_grant_plan = null, ref_grant_until = null, ref_base_plan = null, ref_base_remaining = null where id = p_ref;
    select * into me from public.ttm_profiles where id = p_ref; in_grant := false;
  end if;
  select count(*), count(*) filter (where plan = 'pro') into n_all, n_pro from public.ttm_profiles
    where referred_by = p_ref and ref_paid and plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%';
  if n_pro >= 4 then
    gp := 'pro';
    select plan_until into gu from public.ttm_profiles where referred_by = p_ref and ref_paid and plan = 'pro' and plan_until > now() and plan_note like 'USDT%' order by plan_until desc offset 3 limit 1;
  elsif n_all >= 4 then
    gp := 'premium';
    select plan_until into gu from public.ttm_profiles where referred_by = p_ref and ref_paid and plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%' order by plan_until desc offset 3 limit 1;
  end if;
  if in_grant then own_plan := me.ref_base_plan; own_rem := me.ref_base_remaining;
  elsif me.plan in ('premium','pro') and me.plan_until is not null and me.plan_until > now() then own_plan := me.plan; own_rem := me.plan_until - now();
  elsif me.plan in ('premium','pro') and me.plan_until is null then return;             -- permanent plan given by admin: leave alone
  else own_plan := 'free'; own_rem := null; end if;
  own_tier := public.ttm_tier(own_plan);
  want := gp is not null and gu is not null and public.ttm_tier(gp) >= own_tier;
  if want and in_grant then
    update public.ttm_profiles set plan = gp, plan_until = gu, plan_note = 'Referral reward (free while your referrals stay)', ref_grant_plan = gp, ref_grant_until = gu where id = p_ref;
  elsif want then
    update public.ttm_profiles set ref_base_plan = own_plan, ref_base_remaining = own_rem, ref_grant_plan = gp, ref_grant_until = gu,
      plan = gp, plan_until = gu, plan_note = 'Referral reward (free while your referrals stay)' where id = p_ref;
  elsif in_grant then
    if me.ref_base_plan in ('premium','pro') and coalesce(me.ref_base_remaining, interval '0') > interval '0' then
      update public.ttm_profiles set plan = me.ref_base_plan, plan_until = now() + me.ref_base_remaining, plan_note = 'Restored after referral reward',
        ref_grant_plan = null, ref_grant_until = null, ref_base_plan = null, ref_base_remaining = null where id = p_ref;
    else
      update public.ttm_profiles set plan = 'free', plan_until = null, plan_note = null,
        ref_grant_plan = null, ref_grant_until = null, ref_base_plan = null, ref_base_remaining = null where id = p_ref;
    end if;
  end if;
end $$;
revoke all on function public.ttm_ref_recalc(uuid) from public, anon, authenticated;

create or replace function public.ttm_ref_recalc_all() returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  for r in select distinct referred_by from public.ttm_profiles where referred_by is not null union select id from public.ttm_profiles where ref_grant_plan is not null loop
    perform public.ttm_ref_recalc(r);
  end loop;
end $$;
revoke all on function public.ttm_ref_recalc_all() from public, anon, authenticated;

create or replace function public.ttm_my_referral() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me record; c text; i int; chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if uid is null then raise exception 'sign in first'; end if;
  perform public.ttm_ref_recalc(uid);
  select * into me from public.ttm_profiles where id = uid;
  -- only Premium and Pro members (and admins) can give out a code; Free members can still ENTER one
  if me.ref_code is null and not (coalesce(me.is_admin,false) or (me.plan in ('premium','pro') and (me.plan_until is null or me.plan_until > now()))) then
    return jsonb_build_object('code', null, 'paid_only', true, 'signed', 0, 'paid', 0, 'active', 0, 'active_pro', 0, 'earned_months', 0,
      'plan', me.plan, 'plan_until', me.plan_until, 'has_referrer', me.referred_by is not null,
      'can_enter', me.referred_by is null and me.created_at > now() - interval '7 days');
  end if;
  if me.ref_code is null then
    loop
      c := ''; for i in 1..7 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
      begin update public.ttm_profiles set ref_code = c where id = uid; exit; exception when unique_violation then null; end;
    end loop;
    me.ref_code := c;
  end if;
  return jsonb_build_object('code', me.ref_code,
    'signed', (select count(*) from public.ttm_profiles where referred_by = uid),
    'paid', (select count(*) from public.ttm_profiles where referred_by = uid and ref_paid),
    'active', (select count(*) from public.ttm_profiles where referred_by = uid and ref_paid and plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%'),
    'active_pro', (select count(*) from public.ttm_profiles where referred_by = uid and ref_paid and plan = 'pro' and plan_until > now() and plan_note like 'USDT%'),
    'grant_plan', me.ref_grant_plan, 'grant_until', me.ref_grant_until,
    'earned_months', me.ref_earned,
    'plan', me.plan, 'plan_until', me.plan_until,
    'has_referrer', me.referred_by is not null,
    'can_enter', me.referred_by is null and me.created_at > now() - interval '7 days');
end $$;
grant execute on function public.ttm_my_referral() to authenticated;

-- A new member enters or follows a code (within 7 days of joining, once, never their own).
create or replace function public.ttm_use_referral(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select id into owner from public.ttm_profiles where ref_code = upper(trim(p_code));
  if owner is null or owner = uid then return false; end if;
  -- the code must belong to a paying (Premium / Pro) member or an admin
  if not exists (select 1 from public.ttm_profiles o where o.id = owner and (o.is_admin or (o.plan in ('premium','pro') and (o.plan_until is null or o.plan_until > now())) or o.ref_grant_plan is not null)) then return false; end if;
  -- no loops: if the code owner was themselves referred (directly or through a chain) by the person entering it, refuse
  if exists (with recursive up(id, depth) as (select owner, 0 union all select p.referred_by, up.depth + 1 from public.ttm_profiles p join up on p.id = up.id where p.referred_by is not null and up.depth < 20) select 1 from up where id = uid) then return false; end if;
  update public.ttm_profiles set referred_by = owner
    where id = uid and referred_by is null and created_at > now() - interval '7 days' and plan_until is null;
  return found;
end $$;
grant execute on function public.ttm_use_referral(text) to authenticated;

-- Internal: a member just made a real payment. First payment marks them as a paid referral.
create or replace function public.ttm_referral_credit(p_user uuid, p_plan text, p_term text) returns void
language plpgsql security definer set search_path = public as $$
declare ref uuid; r record; ids uuid[]; n_pro int; months int; own_plan text;
begin
  select referred_by into ref from public.ttm_profiles where id = p_user for update;
  if ref is null then return; end if;
  update public.ttm_profiles set ref_paid = true, ref_paid_at = coalesce(ref_paid_at, now()), ref_plan = coalesce(ref_plan, p_plan), ref_term = coalesce(ref_term, p_term) where id = p_user and not ref_paid;
  if found then
    -- Pro referrer, referrals on Premium: a time bonus instead (1 month monthly / 6 months yearly), once per set of 4.
    select * into r from public.ttm_profiles where id = ref for update;
    own_plan := case when r.ref_grant_plan is not null then r.ref_base_plan else r.plan end;
    select array(select id from public.ttm_profiles where referred_by = ref and ref_paid and not ref_rewarded and ref_term = p_term order by ref_paid_at limit 4) into ids;
    if own_plan = 'pro' and coalesce(array_length(ids, 1), 0) = 4 then
      select count(*) into n_pro from public.ttm_profiles where id = any(ids) and ref_plan = 'pro';
      if n_pro < 4 then
        months := case when p_term = 'month' then 1 else round(12 * (n_pro * 1.0 + (4 - n_pro) * 0.5) / 4)::int end;
        update public.ttm_profiles set ref_rewarded = true where id = any(ids);
        update public.ttm_profiles set ref_earned = ref_earned + months where id = ref;
        if not (r.plan = 'pro' and r.plan_until is null) then perform public.ttm_extend_n(ref, 'pro', months, 'Referral reward (time bonus)'); end if;
      end if;
    end if;
  end if;
  perform public.ttm_ref_recalc(ref);
end $$;
revoke all on function public.ttm_referral_credit(uuid, text, text) from public, anon, authenticated;

-- 7) Called by the payment checker (service role only): a matching deposit arrived for an order.
create or replace function public.ttm_activate_order(p_order uuid, p_txid text, p_from text, p_amount numeric, p_time timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.ttm_orders; until_at timestamptz;
begin
  select * into o from public.ttm_orders where id = p_order for update;
  if not found or o.status = 'paid' then return jsonb_build_object('ok', false); end if;
  if o.plan = 'lens' then until_at := public.ttm_lens_extend(o.user_id, 12, 'usdt');
  else until_at := public.ttm_extend(o.user_id, o.plan, o.term, 'USDT order ' || left(o.id::text, 8)); end if;
  update public.ttm_orders set status = 'paid', txid = p_txid, paid_at = now() where id = o.id;
  if o.plan <> 'lens' then perform public.ttm_referral_credit(o.user_id, o.plan, o.term); perform public.ttm_founders_check(); end if;
  insert into public.ttm_payments (txid, from_addr, amount, tx_time, status, order_id, user_id, note)
    values (p_txid, p_from, p_amount, p_time, 'applied', o.id, o.user_id, o.plan || ' ' || o.term)
    on conflict (txid) do nothing;
  return jsonb_build_object('ok', true, 'until', until_at);
end $$;
revoke all on function public.ttm_activate_order(uuid, text, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.ttm_activate_order(uuid, text, text, numeric, timestamptz) to service_role;

-- 8) Admin: give an unmatched deposit to a member by email.
create or replace function public.ttm_admin_assign_payment(p_txid text, p_email text, p_plan text, p_term text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid; until_at timestamptz;
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  if p_plan not in ('premium','pro','lens') or p_term not in ('month','year') then raise exception 'unknown plan'; end if;
  select id into uid from public.ttm_profiles where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no member with that email'; end if;
  if not exists (select 1 from public.ttm_payments where txid = p_txid and status = 'unmatched') then raise exception 'payment not found or already used'; end if;
  if p_plan = 'lens' then until_at := public.ttm_lens_extend(uid, 12, 'usdt');
  else until_at := public.ttm_extend(uid, p_plan, p_term, 'USDT manual ' || left(p_txid, 8)); end if;
  update public.ttm_payments set status = 'assigned', user_id = uid, note = p_plan || ' ' || p_term || ' (manual)' where txid = p_txid;
  if p_plan <> 'lens' then perform public.ttm_referral_credit(uid, p_plan, p_term); perform public.ttm_founders_check(); end if;
  return jsonb_build_object('ok', true, 'until', until_at);
end $$;
grant execute on function public.ttm_admin_assign_payment(text, text, text, text) to authenticated;

create or replace function public.ttm_admin_ignore_payment(p_txid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  update public.ttm_payments set status = 'ignored' where txid = p_txid and status = 'unmatched';
end $$;
grant execute on function public.ttm_admin_ignore_payment(text) to authenticated;

-- 9) Run the payment checker every minute (after you deploy the usdt-check function).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('ttm-usdt-check'); exception when others then null; end $$;
select cron.schedule('ttm-usdt-check', '* * * * *', $$
  select net.http_post(url := 'https://zqolxnufjsseylzgfztz.supabase.co/functions/v1/usdt-check',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) $$);

-- 10) Re-check every referrer's free tier every 5 minutes (so a lapsed referral is noticed quickly).
do $$ begin perform cron.unschedule('ttm-ref-recalc'); exception when others then null; end $$;
select cron.schedule('ttm-ref-recalc', '*/5 * * * *', $$ select public.ttm_ref_recalc_all() $$);

-- 11) Scheduled price rise: at 00:00 Sydney on 1 Feb 2027 both plan prices go up by 120% (x2.2), once only.
-- Change the date or percent here before it happens, or set "rise_done" to true in ttm_billing.cfg to cancel it.
drop function if exists public.ttm_price_rise_apply();
create or replace function public.ttm_price_rise_apply(p_force boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb; k numeric := 1 + 120 / 100.0; at timestamptz := timestamptz '2027-02-01 00:00:00+11';
begin
  if not p_force and now() < at then return; end if;
  select cfg into c from public.ttm_billing where id = 'main';
  if c is null or coalesce((c ->> 'rise_done')::boolean, false) then return; end if;
  update public.ttm_billing set cfg = c
      || jsonb_build_object('premium', round((c ->> 'premium')::numeric * k, 2), 'pro', round((c ->> 'pro')::numeric * k, 2),
                            'rise_done', true, 'rise_at', now())
    where id = 'main';
end $$;
revoke all on function public.ttm_price_rise_apply(boolean) from public, anon, authenticated;
do $$ begin perform cron.unschedule('ttm-price-rise'); exception when others then null; end $$;
select cron.schedule('ttm-price-rise', '*/10 * * * *', $$ select public.ttm_price_rise_apply(false) $$);


-- 12) TTM LENS access: a member gets LENS in one of two ways.
--   (a) BTCC: they join BTCC through your affiliate link, enter their BTCC UID here, and their trading volume
--       (from your BTCC affiliate export, imported in Admin -> Billing) is at or above the minimum you set.
--   (b) Pay a LENS pass in USDT (default 350 USDT for 12 months). Same payment flow as the plans.
-- Settings live in the billing row: lens_price (default 350), lens_min_volume (default 10000, in USDT), lens_btcc_link (your affiliate link).
alter table public.ttm_profiles add column if not exists lens_until timestamptz;
alter table public.ttm_profiles add column if not exists lens_via text;

create table if not exists public.ttm_btcc_users (
  uid text primary key,
  volume numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ttm_btcc_users enable row level security;
drop policy if exists btcc_admin on public.ttm_btcc_users;
create policy btcc_admin on public.ttm_btcc_users for select using (public.ttm_is_admin());

create table if not exists public.ttm_lens_req (
  user_id uuid primary key references auth.users(id) on delete cascade,
  btcc_uid text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  volume numeric not null default 0,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  note text
);
create unique index if not exists ttm_lens_req_uid on public.ttm_lens_req (btcc_uid);
alter table public.ttm_lens_req enable row level security;
drop policy if exists lensreq_read on public.ttm_lens_req;
create policy lensreq_read on public.ttm_lens_req for select using (user_id = auth.uid() or public.ttm_is_admin());

create or replace function public.ttm_lens_min() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (cfg ->> 'lens_min_volume')::numeric from public.ttm_billing where id = 'main'), 10000) $$;

-- Add paid LENS time (12 months for a pass). Time is added after any current end date.
create or replace function public.ttm_lens_extend(p_user uuid, p_months int, p_via text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare cur timestamptz; nu timestamptz;
begin
  select lens_until into cur from public.ttm_profiles where id = p_user for update;
  if not found then raise exception 'no such member'; end if;
  nu := greatest(coalesce(cur, now()), now()) + make_interval(months => p_months);
  update public.ttm_profiles set lens_until = nu, lens_via = p_via where id = p_user;
  return nu;
end $$;
revoke all on function public.ttm_lens_extend(uuid, int, text) from public, anon, authenticated;

-- Check one member's request against the imported BTCC volumes. Qualifies = approved with no end date.
create or replace function public.ttm_lens_eval(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v numeric;
begin
  select * into r from public.ttm_lens_req where user_id = p_user;
  if not found or r.status = 'rejected' then return; end if;
  select volume into v from public.ttm_btcc_users where uid = r.btcc_uid;
  if v is null then return; end if;
  update public.ttm_lens_req set volume = v where user_id = p_user;
  if v >= public.ttm_lens_min() and r.status <> 'approved' then
    update public.ttm_lens_req set status = 'approved', decided_at = now(), note = 'auto: volume ' || v where user_id = p_user;
    update public.ttm_profiles set lens_until = greatest(coalesce(lens_until, now()), timestamptz '2099-12-31'), lens_via = 'btcc' where id = p_user;
  end if;
end $$;
revoke all on function public.ttm_lens_eval(uuid) from public, anon, authenticated;

-- Member: enter or change their BTCC UID.
create or replace function public.ttm_lens_request(p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u text := upper(regexp_replace(coalesce(p_uid,''), '[^A-Za-z0-9]', '', 'g'));
begin
  if uid is null then raise exception 'sign in first'; end if;
  if length(u) < 4 or length(u) > 24 then raise exception 'Enter your BTCC UID (the number shown in your BTCC profile).'; end if;
  if exists (select 1 from public.ttm_lens_req where btcc_uid = u and user_id <> uid) then raise exception 'That BTCC UID is already linked to another TTM account.'; end if;
  insert into public.ttm_lens_req (user_id, btcc_uid) values (uid, u)
    on conflict (user_id) do update set btcc_uid = excluded.btcc_uid,
      status = case when public.ttm_lens_req.status = 'approved' and public.ttm_lens_req.btcc_uid = excluded.btcc_uid then 'approved' else 'pending' end, requested_at = now();
  perform public.ttm_lens_eval(uid);
  return public.ttm_lens_status();
end $$;
grant execute on function public.ttm_lens_request(text) to authenticated;

create or replace function public.ttm_lens_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); p record; r record;
begin
  if uid is null then return null; end if;
  select lens_until, lens_via into p from public.ttm_profiles where id = uid;
  select * into r from public.ttm_lens_req where user_id = uid;
  return jsonb_build_object('active', coalesce(p.lens_until > now(), false), 'until', p.lens_until, 'via', p.lens_via,
    'req_status', r.status, 'btcc_uid', r.btcc_uid, 'volume', coalesce(r.volume, 0), 'min', public.ttm_lens_min());
end $$;
grant execute on function public.ttm_lens_status() to authenticated;

-- Admin: import the BTCC affiliate export. p_rows = [{"uid":"123456","volume":15000.5}, ...]. Adds or updates volumes, then approves everyone now qualifying.
create or replace function public.ttm_lens_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; a int := 0; r record; was text;
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    if coalesce(x ->> 'uid','') = '' then continue; end if;
    insert into public.ttm_btcc_users (uid, volume) values (upper(regexp_replace(x ->> 'uid', '[^A-Za-z0-9]', '', 'g')), coalesce((x ->> 'volume')::numeric, 0))
      on conflict (uid) do update set volume = excluded.volume, updated_at = now();
    n := n + 1;
  end loop;
  for r in select user_id, status from public.ttm_lens_req where status <> 'rejected' loop
    was := r.status; perform public.ttm_lens_eval(r.user_id);
    if was <> 'approved' and (select status from public.ttm_lens_req where user_id = r.user_id) = 'approved' then a := a + 1; end if;
  end loop;
  return jsonb_build_object('imported', n, 'approved', a);
end $$;
grant execute on function public.ttm_lens_import(jsonb) to authenticated;

-- Admin: approve, reject or revoke one member by hand.
create or replace function public.ttm_lens_admin(p_user uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  if p_action = 'approve' then
    update public.ttm_lens_req set status = 'approved', decided_at = now(), note = 'approved by hand' where user_id = p_user;
    update public.ttm_profiles set lens_until = greatest(coalesce(lens_until, now()), timestamptz '2099-12-31'), lens_via = 'btcc' where id = p_user;
  elsif p_action in ('reject','revoke') then
    update public.ttm_lens_req set status = 'rejected', decided_at = now() where user_id = p_user;
    update public.ttm_profiles set lens_until = case when lens_via = 'usdt' then lens_until else null end where id = p_user;
  end if;
end $$;
grant execute on function public.ttm_lens_admin(uuid, text) to authenticated;


-- 13) Paid-member cap (default 350, change "member_cap" in the billing row). Anyone can read the count to show "full".
create or replace function public.ttm_member_cap() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cap', coalesce((select (cfg ->> 'member_cap')::int from public.ttm_billing where id = 'main'), 350),
    'paid', (select count(*) from public.ttm_profiles where plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%'),
    'full', (select count(*) from public.ttm_profiles where plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%') >= coalesce((select (cfg ->> 'member_cap')::int from public.ttm_billing where id = 'main'), 350)) $$;
grant execute on function public.ttm_member_cap() to anon, authenticated;

-- 14) Free members can read and react in the community rooms but cannot post, reply, vote or start polls.
create or replace function public.ttm_room_free_ro() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select * into p from public.ttm_profiles where id = new.user_id;
  if found and not coalesce(p.is_admin, false) and coalesce(to_jsonb(p) ->> 'beta', 'false') <> 'true' and coalesce(to_jsonb(p) ->> 'team', 'false') <> 'true'
     and (coalesce(p.plan, 'free') = 'free' or (p.plan_until is not null and p.plan_until < now())) then
    raise exception 'Free members can react to posts. Upgrade to post and reply.';
  end if;
  return new;
end $$;
drop trigger if exists ttm_room_free_ro_ins on public.ttm_room_msgs;
create trigger ttm_room_free_ro_ins before insert on public.ttm_room_msgs for each row execute function public.ttm_room_free_ro();


-- 15) Founding members: the first 50 people who pay for Premium or Pro lock in the launch price. When the 50th pays, prices rise 120% straight away
-- (otherwise they rise on 1 Feb 2027, see section 11). Counts each paying person once.
create or replace function public.ttm_founders() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from (
    select user_id from public.ttm_orders where status = 'paid' and plan in ('premium','pro')
    union select user_id from public.ttm_payments where status = 'assigned' and user_id is not null and (note like 'premium%' or note like 'pro%')) x $$;
revoke all on function public.ttm_founders() from public, anon, authenticated;

create or replace function public.ttm_founders_check() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.ttm_founders() >= 50 then perform public.ttm_price_rise_apply(true); end if;
end $$;
revoke all on function public.ttm_founders_check() from public, anon, authenticated;

create or replace function public.ttm_member_cap() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cap', coalesce((select (cfg ->> 'member_cap')::int from public.ttm_billing where id = 'main'), 350),
    'paid', (select count(*) from public.ttm_profiles where plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%'),
    'full', (select count(*) from public.ttm_profiles where plan in ('premium','pro') and plan_until > now() and plan_note like 'USDT%') >= coalesce((select (cfg ->> 'member_cap')::int from public.ttm_billing where id = 'main'), 350),
    'founders', public.ttm_founders(),
    'founding_open', not coalesce((select (cfg ->> 'rise_done')::boolean from public.ttm_billing where id = 'main'), false) and now() < timestamptz '2027-02-01 00:00:00+11') $$;
grant execute on function public.ttm_member_cap() to anon, authenticated;

-- 16) Invitation page: show who invited you. Returns only the public display name for a referral code.
create or replace function public.ttm_ref_name(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(both '@' from coalesce(tg_handle, '')), '') from public.ttm_profiles where ref_code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')) limit 1 $$;
grant execute on function public.ttm_ref_name(text) to anon, authenticated;


-- 17) Give TTM LENS for a limited time (giveaways and trials), like the plan giveaway. It ends by itself: access is "lens_until is in the future".
create or replace function public.ttm_grant_lens(p_emails text[], p_hours int, p_note text default 'giveaway') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz; v_ok text[]; v_kept text[]; v_none text[];
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 24 * 3650 then raise exception 'bad length'; end if;
  v_until := now() + make_interval(hours => p_hours);
  with em as (select distinct lower(btrim(x)) as e from unnest(p_emails) x where btrim(x) <> ''),
       up as (update public.ttm_profiles p set lens_until = v_until, lens_via = 'gift'
              from em where lower(p.email) = em.e and not p.is_admin and (p.lens_until is null or p.lens_until < v_until) returning p.email)
  select coalesce(array_agg(email), '{}') into v_ok from up;
  select coalesce(array_agg(p.email), '{}') into v_kept from public.ttm_profiles p
   where lower(p.email) in (select distinct lower(btrim(x)) from unnest(p_emails) x) and not (p.email = any(v_ok)) and not p.is_admin;
  select coalesce(array_agg(e), '{}') into v_none from (select distinct lower(btrim(x)) as e from unnest(p_emails) x where btrim(x) <> '') em
   where e not in (select lower(email) from public.ttm_profiles);
  return jsonb_build_object('granted', v_ok, 'kept', v_kept, 'no_account', v_none, 'until', v_until);
end $$;
revoke all on function public.ttm_grant_lens(text[], int, text) from public, anon;
grant execute on function public.ttm_grant_lens(text[], int, text) to authenticated;

-- Take back gifted LENS time early (paid and BTCC access is never touched)
create or replace function public.ttm_revoke_lens(p_emails text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.ttm_is_admin() then raise exception 'admins only'; end if;
  update public.ttm_profiles set lens_until = null, lens_via = null
   where lens_via = 'gift' and lower(email) in (select distinct lower(btrim(x)) from unnest(p_emails) x);
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.ttm_revoke_lens(text[]) from public, anon;
grant execute on function public.ttm_revoke_lens(text[]) to authenticated;
