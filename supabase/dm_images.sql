-- Photos in private messages (Message TTM / Inbox). Safe to run more than once. Run the whole thing in the Supabase SQL editor.
-- Photos use the same safe pipeline as the community rooms: upload to room-pending, scan-image checks them, then they are moved
-- to room-images/<your user id>/ and the link is saved with the message.
alter table public.ttm_chat add column if not exists img text;

-- a message can now be a photo with no text
alter table public.ttm_chat drop constraint if exists ttm_chat_body_check;
alter table public.ttm_chat drop constraint if exists ttm_chat_body_len;
alter table public.ttm_chat add constraint ttm_chat_body_len check (char_length(body) <= 2000 and (char_length(body) >= 1 or img is not null));

-- the photo link must be one that scan-image produced for the person sending it
create or replace function public.ttm_chat_img_check() returns trigger language plpgsql as $$
begin
  if new.img is not null and new.img not like '%/storage/v1/object/public/room-images/' || auth.uid()::text || '/%' then
    raise exception 'Images must be scanned first';
  end if;
  return new;
end $$;
drop trigger if exists ttm_chat_img on public.ttm_chat;
create trigger ttm_chat_img before insert on public.ttm_chat for each row execute function public.ttm_chat_img_check();
