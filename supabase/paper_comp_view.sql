-- TTM LENS paper trading: lets players in a competition see each other's open trades (entry, stop loss, take profit) on the competition page.
-- Only people who have joined that competition (and admins) can see them. Run once in the Supabase SQL Editor. Safe to run again.
drop policy if exists paper_tr_comp on public.ttm_paper_trades;
create policy paper_tr_comp on public.ttm_paper_trades for select to authenticated using (
  exists (
    select 1 from public.ttm_paper_accounts a
    join public.ttm_paper_accounts me on me.comp_id = a.comp_id and me.user_id = auth.uid()
    where a.id = ttm_paper_trades.account_id and a.comp_id is not null));
