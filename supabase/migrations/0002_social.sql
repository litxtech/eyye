-- Follows, follow requests, blocks
create table if not exists public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists user_follows_following_idx on public.user_follows (following_id);

create table if not exists public.follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (requester_id, target_id)
);
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, status);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- Helpers
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.is_following(follower uuid, following uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_follows where follower_id = follower and following_id = following
  );
$$;

-- Block removes follow relationships both ways
create or replace function public.on_user_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);
  delete from public.follow_requests
   where (requester_id = new.blocker_id and target_id = new.blocked_id)
      or (requester_id = new.blocked_id and target_id = new.blocker_id);
  return new;
end $$;

drop trigger if exists user_block_cleanup on public.user_blocks;
create trigger user_block_cleanup after insert on public.user_blocks
  for each row execute function public.on_user_block();

alter table public.user_follows enable row level security;
alter table public.follow_requests enable row level security;
alter table public.user_blocks enable row level security;

create policy "follows_read" on public.user_follows for select to authenticated using (true);
create policy "follows_insert" on public.user_follows for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked_between(follower_id, following_id));
create policy "follows_delete" on public.user_follows for delete to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());

create policy "requests_read" on public.follow_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
create policy "requests_insert" on public.follow_requests for insert to authenticated
  with check (requester_id = auth.uid());
create policy "requests_update" on public.follow_requests for update to authenticated
  using (target_id = auth.uid() or requester_id = auth.uid());
create policy "requests_delete" on public.follow_requests for delete to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());

create policy "blocks_read" on public.user_blocks for select to authenticated
  using (blocker_id = auth.uid());
create policy "blocks_insert" on public.user_blocks for insert to authenticated
  with check (blocker_id = auth.uid());
create policy "blocks_delete" on public.user_blocks for delete to authenticated
  using (blocker_id = auth.uid());
