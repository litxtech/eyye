-- Push delivery pipeline: internal config, follow notifications, DB->Edge hook

-- Shared secret readable only by service role / security definer (never exposed via PostgREST)
create table if not exists public.internal_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.internal_config enable row level security;
-- no policies: authenticated/anon get nothing; service role bypasses RLS

insert into public.internal_config (key, value)
values ('push_hook_token', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Follow notifications
create or replace function public.notify_new_follow()
returns trigger language plpgsql security definer set search_path = public as $$
declare fname text;
begin
  select coalesce(display_name, username) into fname from public.profiles where id = new.follower_id;
  perform public.notify_user(new.following_id, 'follow', 'Yeni takipçi',
    coalesce(fname, 'Birisi') || ' seni takip etmeye başladı',
    jsonb_build_object('user_id', new.follower_id, 'kind', 'follow'), new.follower_id);
  return new;
end $$;

drop trigger if exists follows_notify on public.user_follows;
create trigger follows_notify after insert on public.user_follows
  for each row execute function public.notify_new_follow();

-- DB -> Edge Function hook: when a push delivery job is queued, ping send-push.
create extension if not exists supabase_functions;

create or replace function public.hook_push_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hook_token text;
  anon_key text := 'sb_publishable_ov0KHM-5KA5pqxdeZrXOGg_ubr36RQG';
begin
  select value into hook_token from public.internal_config where key = 'push_hook_token';
  perform extensions.supabase_functions.http_request(
    url := 'https://boemlouaslpxwnuojfaz.supabase.co/functions/v1/send-push',
    method := 'POST',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key,
      'x-internal-token', coalesce(hook_token, '')
    ),
    body := jsonb_build_object('job_id', new.id, 'notification_id', new.notification_id),
    timeout_milliseconds := 5000
  );
  return new;
end $$;

drop trigger if exists ndj_push_hook on public.notification_delivery_jobs;
create trigger ndj_push_hook after insert on public.notification_delivery_jobs
  for each row when (new.channel = 'push')
  execute function public.hook_push_delivery();
