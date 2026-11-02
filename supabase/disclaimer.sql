-- TTM disclaimer acceptances. Safe to run more than once.
-- Kept until TTM removes them in Admin, even if the member later closes their account (no link that deletes it).
create table if not exists public.ttm_acceptances (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid(),
  email       text,
  tg_handle   text,
  version     text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);
alter table public.ttm_acceptances enable row level security;
drop policy if exists p_acc_sel on public.ttm_acceptances;
create policy p_acc_sel on public.ttm_acceptances for select to authenticated using (user_id = auth.uid() or public.ttm_is_admin());
drop policy if exists p_acc_ins on public.ttm_acceptances;
create policy p_acc_ins on public.ttm_acceptances for insert to authenticated with check (user_id = auth.uid());
drop policy if exists p_acc_del on public.ttm_acceptances;
create policy p_acc_del on public.ttm_acceptances for delete to authenticated using (public.ttm_is_admin());
revoke all on public.ttm_acceptances from anon, authenticated;
grant select, insert, delete on public.ttm_acceptances to authenticated;

-- email, name and time are filled in by the database, not the browser
create or replace function public.ttm_acc_fix() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select email, tg_handle into new.email, new.tg_handle from public.ttm_profiles where id = new.user_id;
  new.accepted_at := now();
  return new;
end $$;
drop trigger if exists ttm_acc_fix on public.ttm_acceptances;
create trigger ttm_acc_fix before insert on public.ttm_acceptances for each row execute function public.ttm_acc_fix();
