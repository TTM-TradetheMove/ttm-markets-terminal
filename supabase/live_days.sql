-- Live sessions: repeat on chosen weekdays (0 = Sunday ... 6 = Saturday, Sydney time)
alter table public.ttm_live add column if not exists repeat_dow int[] not null default '{}';
