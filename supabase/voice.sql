-- Voice notes in the community chat, and sending one message to several rooms. Run once in the Supabase SQL editor. Safe to run again.
-- Run badges2.sql first (this keeps the badge logic).
alter table public.ttm_room_msgs add column if not exists audio text;
alter table public.ttm_room_msgs add column if not exists audio_secs int;
alter table public.ttm_room_msgs drop constraint if exists ttm_room_has_content;
alter table public.ttm_room_msgs add constraint ttm_room_has_content check (char_length(body) > 0 or img is not null or audio is not null);

-- public bucket for voice notes: each member can only add files inside their own folder, 3.5 MB max, audio types only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-voice', 'room-voice', true, 3670016, array['audio/webm','audio/mp4','audio/ogg','audio/mpeg'])
on conflict (id) do update set public = true, file_size_limit = 3670016, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists p_room_voice_ins on storage.objects;
create policy p_room_voice_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'room-voice' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.ttm_room_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if to_jsonb(new)->>'poll' is not null and not public.ttm_is_admin() then raise exception 'Only TTM can post polls'; end if;
  if new.img is not null and new.img not like '%/storage/v1/object/public/room-images/' || new.user_id::text || '/%' then
    raise exception 'Images must be scanned first';
  end if;
  if new.audio is not null and new.audio not like '%/storage/v1/object/public/room-voice/' || new.user_id::text || '/%' then
    raise exception 'Voice notes must be uploaded from the chat';
  end if;
  select tg_handle, is_admin, badges into p from public.ttm_profiles where id = new.user_id;
  new.name := coalesce(nullif(trim(both '@' from coalesce(p.tg_handle, '')), ''), 'Member-' || substr(new.user_id::text, 1, 4));
  new.badges := public.ttm_badges_of(p.is_admin, p.badges);
  new.badge := case when p.is_admin then 'TTM' when 'team' = any(coalesce(p.badges, '{}')) then 'TTM Team' else null end;
  -- one message every few seconds for members (TTM is exempt so one send can go to several rooms)
  if not coalesce(p.is_admin, false) and exists (select 1 from public.ttm_room_msgs where user_id = new.user_id and ts > now() - interval '3 seconds') then
    raise exception 'Slow down: one message every few seconds';
  end if;
  return new;
end $$;
