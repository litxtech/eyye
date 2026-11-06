-- Okey concurrency: optimistic-lock version on table state so simultaneous
-- client/bot mutations can't corrupt game state under load.
alter table public.okey_tables
  add column if not exists version integer not null default 0;
