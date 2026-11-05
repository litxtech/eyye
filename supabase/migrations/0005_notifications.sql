-- In-app notifications + delivery jobs for push
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table if not exists public.notification_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null default 'push' check (channel in ('push','in_app')),
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ndj_pending_idx on public.notification_delivery_jobs (status, scheduled_for);

alter table public.notifications enable row level security;
alter table public.notification_delivery_jobs enable row level security;

create policy "notif_read_own" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notif_update_own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notif_insert_service" on public.notifications for insert to authenticated
  with check (user_id <> auth.uid() or public.is_moderator());

create policy "ndj_no_client" on public.notification_delivery_jobs for all to authenticated
  using (false) with check (false);

-- Insert notification helper for triggers/edge functions (service role bypasses RLS anyway)
create or replace function public.notify_user(
  p_user uuid, p_type text, p_title text, p_body text default null,
  p_data jsonb default '{}'::jsonb, p_actor uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  insert into public.notifications (user_id, type, title, body, data, actor_id)
  values (p_user, p_type, p_title, p_body, p_data, p_actor)
  returning id into nid;
  insert into public.notification_delivery_jobs (notification_id, user_id)
  values (nid, p_user);
  return nid;
end $$;

-- Notify conversation members on new message (excluding sender)
create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cname text;
  sender_name text;
  is_group boolean;
begin
  select c.type = 'group', coalesce(c.name, p.display_name, p.username)
    into is_group, cname
  from public.conversations c
  left join public.profiles p on p.id = new.sender_id
  where c.id = new.conversation_id;
  select coalesce(display_name, username) into sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, title, body, data, actor_id)
  select cm.user_id,
         case when is_group then 'group_message' else 'message' end,
         coalesce(cname, sender_name, 'New message'),
         left(coalesce(new.content, ''), 140),
         jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
         new.sender_id
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
    and cm.left_at is null
    and (cm.muted_until is null or cm.muted_until < now())
    and not exists (
      select 1 from public.user_notification_preferences np
      where np.user_id = cm.user_id
        and case when is_group then np.messages else np.messages end = false
    );
  return new;
end $$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_new_message();

-- Realtime for notifications
alter publication supabase_realtime add table public.notifications;
