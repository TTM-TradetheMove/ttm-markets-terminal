-- Image scanning for community chat. Run once in the Supabase SQL editor.
-- 1) private quarantine bucket: members upload here first
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-pending', 'room-pending', false, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists p_room_pend_ins on storage.objects;
create policy p_room_pend_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'room-pending' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2) members can no longer write straight into the public bucket (only the scan-image function can)
drop policy if exists p_room_img_ins on storage.objects;

-- 3) a chat message may only carry an image that lives in the sender's own scanned folder
create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if to_jsonb(new)->>'poll' is not null and not public.ttm_is_admin() then raise exception 'Only TTM can post polls'; end if;
  if new.img is not null and new.img not like '%/storage/v1/object/public/room-images/' || new.user_id::text || '/%' then
    raise exception 'Images must be scanned first';
  end if;
  select tg_handle into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  if exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;
