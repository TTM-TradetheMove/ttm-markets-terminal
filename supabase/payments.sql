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
  '{"premium":19.95,"pro":65,"year_months":10,"address":"TQ9jFWj43xJC1QM5tAnsDHV1fLnhCfF5Yi","order_minutes":60,"sale":{"on":false,"name":"","pct":0,"ends":null}}'::jsonb)
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
  plan text not null check (plan in ('premium','pro')),
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
declare c jsonb; base numeric; pct numeric := 0; ends timestamptz;
begin
  select cfg into c from public.ttm_billing where id = 'main';
  base := (c ->> p_plan)::numeric;
  if base is null then raise exception 'unknown plan'; end if;
  if p_term = 'year' then base := base * coalesce((c ->> 'year_months')::numeric, 10); end if;
  if coalesce((c #>> '{sale,on}')::boolean, false) then
    ends := nullif(c #>> '{sale,ends}', '')::timestamptz;
    if ends is null or ends > now() then pct := least(90, greatest(0, coalesce((c #>> '{sale,pct}')::numeric, 0))); end if;
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
  if p_plan not in ('premium','pro') or p_term not in ('month','year') then raise exception 'unknown plan'; end if;
  update public.ttm_orders set status = 'expired' where status = 'open' and expires_at < now();
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
create or replace function public.ttm_extend(p_user uuid, p_plan text, p_term text, p_note text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare cur record; start_at timestamptz; new_until timestamptz;
begin
  select plan, plan_until into cur from public.ttm_profiles where id = p_user for update;
  if not found then raise exception 'no such member'; end if;
  start_at := case when cur.plan = p_plan and cur.plan_until is not null and cur.plan_until > now() then cur.plan_until else now() end;
  new_until := start_at + case when p_term = 'year' then interval '12 months' else interval '1 month' end;
  update public.ttm_profiles set plan = p_plan, plan_until = new_until, plan_note = p_note where id = p_user;
  return new_until;
end $$;
revoke all on function public.ttm_extend(uuid, text, text, text) from public, anon, authenticated;

-- 6b) Referrals. A member shares a code; only a referred member's FIRST PAID order counts.
--     4 referred members who paid monthly = 1 month free for the referrer; 4 who paid yearly = 12 months free.
alter table public.ttm_profiles add column if not exists ref_code text;
alter table public.ttm_profiles add column if not exists referred_by uuid;
alter table public.ttm_profiles add column if not exists ref_paid boolean not null default false;
alter table public.ttm_profiles add column if not exists ref_month int not null default 0;
alter table public.ttm_profiles add column if not exists ref_year int not null default 0;
alter table public.ttm_profiles add column if not exists ref_earned int not null default 0;
create unique index if not exists ttm_profiles_ref_code on public.ttm_profiles (ref_code);

create or replace function public.ttm_my_referral() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me record; c text; i int; chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into me from public.ttm_profiles where id = uid;
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
    'month_progress', me.ref_month, 'year_progress', me.ref_year, 'earned_months', me.ref_earned,
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
  update public.ttm_profiles set referred_by = owner
    where id = uid and referred_by is null and created_at > now() - interval '7 days' and plan_until is null;
  return found;
end $$;
grant execute on function public.ttm_use_referral(text) to authenticated;

-- Internal: a member just made a real payment. First time only, credit whoever referred them.
create or replace function public.ttm_referral_credit(p_user uuid, p_term text) returns void
language plpgsql security definer set search_path = public as $$
declare ref uuid; r record; plan_now text; add_term text;
begin
  select referred_by into ref from public.ttm_profiles where id = p_user and not ref_paid for update;
  if ref is null then return; end if;
  update public.ttm_profiles set ref_paid = true where id = p_user;
  if p_term = 'year' then update public.ttm_profiles set ref_year = ref_year + 1 where id = ref;
  else update public.ttm_profiles set ref_month = ref_month + 1 where id = ref; end if;
  select plan, plan_until, ref_month, ref_year into r from public.ttm_profiles where id = ref for update;
  for add_term in select x from (select 'year' as x where r.ref_year >= 4 union all select 'month' where r.ref_month >= 4) q loop
    if add_term = 'year' then update public.ttm_profiles set ref_year = ref_year - 4, ref_earned = ref_earned + 12 where id = ref;
    else update public.ttm_profiles set ref_month = ref_month - 4, ref_earned = ref_earned + 1 where id = ref; end if;
    select plan, plan_until into r from public.ttm_profiles where id = ref;
    if r.plan in ('premium','pro') and r.plan_until is null then continue; end if;   -- already has a permanent plan: nothing to extend
    plan_now := case when r.plan in ('premium','pro') and r.plan_until > now() then r.plan else 'premium' end;
    perform public.ttm_extend(ref, plan_now, add_term, 'Referral reward');
  end loop;
end $$;
revoke all on function public.ttm_referral_credit(uuid, text) from public, anon, authenticated;

-- 7) Called by the payment checker (service role only): a matching deposit arrived for an order.
create or replace function public.ttm_activate_order(p_order uuid, p_txid text, p_from text, p_amount numeric, p_time timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.ttm_orders; until_at timestamptz;
begin
  select * into o from public.ttm_orders where id = p_order for update;
  if not found or o.status = 'paid' then return jsonb_build_object('ok', false); end if;
  until_at := public.ttm_extend(o.user_id, o.plan, o.term, 'USDT order ' || left(o.id::text, 8));
  update public.ttm_orders set status = 'paid', txid = p_txid, paid_at = now() where id = o.id;
  perform public.ttm_referral_credit(o.user_id, o.term);
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
  if p_plan not in ('premium','pro') or p_term not in ('month','year') then raise exception 'unknown plan'; end if;
  select id into uid from public.ttm_profiles where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no member with that email'; end if;
  if not exists (select 1 from public.ttm_payments where txid = p_txid and status = 'unmatched') then raise exception 'payment not found or already used'; end if;
  until_at := public.ttm_extend(uid, p_plan, p_term, 'USDT manual ' || left(p_txid, 8));
  update public.ttm_payments set status = 'assigned', user_id = uid, note = p_plan || ' ' || p_term || ' (manual)' where txid = p_txid;
  perform public.ttm_referral_credit(uid, p_term);
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
