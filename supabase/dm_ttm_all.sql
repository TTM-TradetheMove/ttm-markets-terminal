-- Every signed-in member can message TTM (previously Pro only)
drop policy if exists p_ch_ins on public.ttm_chat;
create policy p_ch_ins on public.ttm_chat for insert with check (
  (member_id = auth.uid() and from_admin = false) or (public.ttm_is_admin() and from_admin = true));
