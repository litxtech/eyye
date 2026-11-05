-- Messaging: conversations, members, messages, receipts, reactions, pins, drafts, invites
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct','group')),
  name text,
  description text,
  avatar_url text,
  created_by uuid references public.profiles(id),
  invite_token text unique,
  invite_revoked_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  muted_until timestamptz,
  pinned boolean not null default false,
  archived boolean not null default false,
  cleared_at timestamptz,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user_idx on public.conversation_members (user_id) where left_at is null;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id text,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  reply_to uuid references public.messages(id) on delete set null,
  type text not null default 'text' check (type in ('text','image','video','audio','voice','file','gif','sticker','location','live_location','contact','album','system')),
  content text,
  metadata jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_for_everyone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, client_id)
);
create index if not exists messages_conv_created_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_conv_id_idx on public.messages (conversation_id, id);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'delivered' check (status in ('delivered','read')),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  type text not null,
  url text not null,
  thumbnail_url text,
  mime text,
  size_bytes bigint,
  duration_ms int,
  width int,
  height int,
  position int not null default 0
);

create table if not exists public.message_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

create table if not exists public.message_drafts (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.chat_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden boolean not null default false,
  primary key (conversation_id, user_id)
);

-- Membership helpers
create or replace function public.is_conversation_member(conv uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = uid and left_at is null
  );
$$;

create or replace function public.can_send_in_conversation(conv uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_conversation_member(conv, uid)
     and not public.is_blocked_between(uid, (
       select cm2.user_id from public.conversation_members cm2
       join public.conversations c on c.id = cm2.conversation_id
       where cm2.conversation_id = conv and cm2.user_id <> uid and c.type = 'direct'
       limit 1));
$$;

-- Keep conversation last_message_at fresh
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at, updated_at = now() where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists messages_touch_conv on public.messages;
create trigger messages_touch_conv after insert on public.messages
  for each row execute function public.touch_conversation();

-- Direct conversation uniqueness: one direct conv per unordered pair
create or replace function public.find_or_create_direct(a uuid, b uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  lo uuid := least(a,b);
  hi uuid := greatest(a,b);
begin
  if public.is_blocked_between(a,b) then
    raise exception 'blocked';
  end if;
  select c.id into cid
  from public.conversations c
  join public.conversation_members m1 on m1.conversation_id = c.id and m1.user_id = lo and m1.left_at is null
  join public.conversation_members m2 on m2.conversation_id = c.id and m2.user_id = hi and m2.left_at is null
  where c.type = 'direct'
    and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id and cm.left_at is null) = 2
  limit 1;
  if cid is not null then return cid; end if;
  insert into public.conversations (type, created_by) values ('direct', a) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id) values (cid, lo), (cid, hi);
  return cid;
end $$;

-- RLS
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_pins enable row level security;
alter table public.message_drafts enable row level security;
alter table public.chat_preferences enable row level security;

create policy "convs_read" on public.conversations for select to authenticated
  using (public.is_conversation_member(id));
create policy "convs_insert" on public.conversations for insert to authenticated
  with check (created_by = auth.uid() or type = 'direct');
create policy "convs_update" on public.conversations for update to authenticated
  using (exists (select 1 from public.conversation_members cm where cm.conversation_id = id and cm.user_id = auth.uid() and cm.left_at is null and cm.role in ('owner','admin')));

create policy "members_read" on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id) or user_id = auth.uid());
create policy "members_insert" on public.conversation_members for insert to authenticated
  with check (user_id = auth.uid() or public.is_conversation_member(conversation_id));
create policy "members_update" on public.conversation_members for update to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')))
  with check (user_id = auth.uid() or exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));
create policy "members_delete" on public.conversation_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid() and cm.role in ('owner','admin')));

create policy "messages_read" on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "messages_insert" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_send_in_conversation(conversation_id));
create policy "messages_update" on public.messages for update to authenticated
  using (sender_id = auth.uid() and deleted_for_everyone_at is null)
  with check (sender_id = auth.uid());
create policy "messages_delete" on public.messages for delete to authenticated
  using (sender_id = auth.uid() or exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_id and cm.user_id = auth.uid() and cm.role = 'owner'));

create policy "receipts_rw" on public.message_receipts for all to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)))
  with check (user_id = auth.uid());

create policy "reactions_rw" on public.message_reactions for all to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)))
  with check (user_id = auth.uid());

create policy "attachments_read" on public.message_attachments for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)));

create policy "pins_rw" on public.message_pins for all to authenticated
  using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id) and pinned_by = auth.uid());

create policy "drafts_rw" on public.message_drafts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "chatprefs_rw" on public.chat_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.message_receipts;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null; end $$;
