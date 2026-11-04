-- Changing the starting balance now shifts the whole equity history, so Equity moves and the Result (profit or loss) stays the same.
-- Run once in the Supabase SQL editor. Safe to run again.
create or replace function public.ttm_engine_set_balance(new_balance numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old numeric;
begin
  if not public.ttm_is_admin() then raise exception 'admin only'; end if;
  if new_balance is null or new_balance < 100 then raise exception 'balance must be at least 100'; end if;
  select start_balance into old from public.ttm_engine_config where id = 1;
  update public.ttm_engine_config set start_balance = new_balance, updated_at = now() where id = 1;
  update public.ttm_engine_equity set equity = equity + (new_balance - old), cash = cash + (new_balance - old);
end $$;
grant execute on function public.ttm_engine_set_balance(numeric) to authenticated;
