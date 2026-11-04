-- Longer voice notes (up to 10 minutes, 8 MB). Run once in the Supabase SQL editor. Safe to run again.
update storage.buckets set file_size_limit = 8388608, allowed_mime_types = array['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/x-m4a','audio/aac'] where id = 'room-voice';
