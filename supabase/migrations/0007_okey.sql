-- Premium Okey: tables, players, hands (private), moves, chat, invites, viewers, stats
-- NOTE: game-rule validation (melds, finish, scoring) lives in the `okey-action`
-- Edge Function (service role). This file owns schema, membership, dealing and RLS.

create table if not exists public.okey_tables (
  id uuid primary key default gen_random_uuid(),
  livekit_room text not null unique,
  name text not null default 'VIP Okey',
  mode text not null default 'solo' check (mode in ('solo','pairs')),
  status text not null default 'waiting' check (status in ('waiting','playing','finished','closed')),
  host_id uuid not null references public.profiles(id),
  turn_seconds int not null default 30,
  allow_viewers boolean not null default true,
  password_hash text,
  max_viewers int not null default 30,
  state jsonb not null default '{}'::jsonb,
  winner_seat int,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.okey_players (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.okey_tables(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  seat int not null check (seat between 0 and 3),
  is_bot boolean not null default false,
  team int check (team in (0,1)),
  score int not null default 0,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (table_id, seat),
  unique (table_id, user_id)
);

create table if not exists public.okey_hands (
  table_id uuid not null references public.okey_tables(id) on delete cascade,
  seat int not null,
  tiles jsonb not null default '[]'::jsonb,
  melds jsonb not null default '[]'::jsonb,
  primary key (table_id, seat)
);

create table if not exists public.okey_moves (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.okey_tables(id) on delete cascade,
  seat int,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists okey_moves_table_idx on public.okey_moves (table_id, id);

create table if not exists public.okey_chat (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.okey_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.okey_invites (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.okey_tables(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  seat_hint int,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  unique (table_id, to_user)
);

create table if not exists public.okey_viewers (
  table_id uuid not null references public.okey_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

create table if not exists public.okey_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  solo_games int not null default 0,
  solo_wins int not null default 0,
  pairs_games int not null default 0,
  pairs_wins int not null default 0,
  total_points int not null default 0,
  xp int not null default 0,
  level int not null default 1,
  updated_at timestamptz not null default now()
);

-- helpers --------------------------------------------------------------------
create or replace function public.okey_my_seat(p_table uuid, p_user uuid default auth.uid())
returns int language sql stable security definer set search_path = public as $$
  select seat from public.okey_players
   where table_id = p_table and user_id = p_user and left_at is null limit 1;
$$;

create or replace function public.okey_is_member(p_table uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.okey_players where table_id = p_table and user_id = p_user and left_at is null)
      or exists (select 1 from public.okey_viewers where table_id = p_table and user_id = p_user);
$$;

create or replace function public.okey_create_table(
  p_room_name text, p_mode text default 'solo', p_name text default 'VIP Okey',
  p_turn_seconds int default 30, p_allow_viewers boolean default true,
  p_password text default null
) returns public.okey_tables
language plpgsql security definer set search_path = public as $$
declare t public.okey_tables;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_mode not in ('solo','pairs') then raise exception 'bad_mode'; end if;
  insert into public.okey_tables (livekit_room, name, mode, host_id, turn_seconds, allow_viewers, password_hash)
  values (p_room_name, left(coalesce(p_name,'VIP Okey'),60), p_mode, auth.uid(),
          greatest(10, least(120, coalesce(p_turn_seconds,30))), coalesce(p_allow_viewers,true),
          case when p_password is null or p_password = '' then null
               else encode(digest(p_password, 'sha256'), 'hex') end)
  returning * into t;
  insert into public.okey_players (table_id, user_id, seat, team)
  values (t.id, auth.uid(), 0, case when p_mode='pairs' then 0 else null end);
  insert into public.okey_stats (user_id) values (auth.uid()) on conflict do nothing;
  return t;
end $$;

create or replace function public.okey_join_table(p_table uuid, p_password text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  t public.okey_tables; seat_free int; my_team int; cnt int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into t from public.okey_tables where id = p_table for update;
  if t.id is null then raise exception 'not_found'; end if;
  if t.status <> 'waiting' then raise exception 'game_started'; end if;
  if t.password_hash is not null then
    if p_password is null or encode(digest(p_password,'sha256'),'hex') <> t.password_hash then
      raise exception 'bad_password';
    end if;
  end if;
  select seat into seat_free from public.okey_players
   where table_id = p_table and user_id = auth.uid() and left_at is null;
  if seat_free is not null then return seat_free; end if;
  select count(*) into cnt from public.okey_players where table_id = p_table and left_at is null;
  if cnt >= 4 then raise exception 'table_full'; end if;
  select s into seat_free from generate_series(0,3) s
   where not exists (select 1 from public.okey_players where table_id = p_table and seat = s and left_at is null)
   order by s limit 1;
  my_team := case when t.mode = 'pairs' then seat_free % 2 else null end;
  insert into public.okey_players (table_id, user_id, seat, team)
  values (p_table, auth.uid(), seat_free, my_team);
  insert into public.okey_stats (user_id) values (auth.uid()) on conflict do nothing;
  return seat_free;
end $$;

create or replace function public.okey_leave_table(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.okey_players set left_at = now(), connected = false
   where table_id = p_table and user_id = auth.uid() and left_at is null;
  delete from public.okey_viewers where table_id = p_table and user_id = auth.uid();
end $$;

create or replace function public.okey_watch(p_table uuid, p_password text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.okey_tables; cnt int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into t from public.okey_tables where id = p_table;
  if t.id is null then raise exception 'not_found'; end if;
  if not t.allow_viewers then raise exception 'viewers_disabled'; end if;
  if t.password_hash is not null and (p_password is null or encode(digest(p_password,'sha256'),'hex') <> t.password_hash) then
    raise exception 'bad_password';
  end if;
  if public.okey_my_seat(p_table) is not null then return; end if;
  select count(*) into cnt from public.okey_viewers where table_id = p_table;
  if cnt >= t.max_viewers then raise exception 'viewer_limit'; end if;
  insert into public.okey_viewers (table_id, user_id) values (p_table, auth.uid()) on conflict do nothing;
end $$;

-- Deal: 106 tiles, seat0=15 others=14, indicator + stock in state
create or replace function public.okey_start(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.okey_tables; n int; deck int[]; pos int := 0; seat int; i int; cnt int;
  hand jsonb; state jsonb; indicator int; ind_color int;
begin
  select * into t from public.okey_tables where id = p_table for update;
  if t.id is null or t.host_id <> auth.uid() then raise exception 'forbidden'; end if;
  if t.status <> 'waiting' then raise exception 'already_started'; end if;
  select count(*) into n from public.okey_players where table_id = p_table and left_at is null;
  if n < 4 then raise exception 'need_4_players'; end if;

  deck := array(select s from unnest(array(select generate_series(0,103)) || array[104,105]) s order by random());

  for seat in 0..3 loop
    cnt := case when seat = 0 then 15 else 14 end;
    hand := '[]'::jsonb;
    for i in 1..cnt loop hand := hand || to_jsonb(deck[pos]); pos := pos + 1; end loop;
    insert into public.okey_hands (table_id, seat, tiles) values (p_table, seat, hand)
      on conflict (table_id, seat) do update set tiles = excluded.tiles;
    insert into public.okey_players (table_id, seat, is_bot)
      select p_table, seat, true from public.okey_players p2
      where p2.table_id = p_table and p2.seat = seat and p2.user_id is null
      on conflict do nothing;
  end loop;

  indicator := deck[pos]; pos := pos + 1;
  select (indicator / 26) into ind_color; -- 0..3 or -1 for fake
  state := jsonb_build_object(
    'phase','playing','turn_seat',0,
    'stock', to_jsonb(deck[pos:array_length(deck,1)]),
    'stock_count', greatest(0, array_length(deck,1)-pos+1),
    'discards', '{"0":[],"1":[],"2":[],"3":[]}'::jsonb,
    'indicator', indicator,
    'okey_tile', case when ind_color = 0 then 105 else 104 end,
    'turn_started_at', now(),
    'turn_seconds', t.turn_seconds,
    'must_take_discard', false,
    'last_move', null
  );
  update public.okey_tables set status='playing', started_at=now(), state=state where id=p_table;
  insert into public.okey_moves (table_id, seat, type, payload) values (p_table, null, 'game_start', jsonb_build_object('mode', t.mode));
end $$;

-- Public state for a member/viewer: strips hands entirely
create or replace function public.okey_state(p_table uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.okey_tables; my_seat int; hand jsonb := null; st jsonb;
begin
  if auth.uid() is null or not public.okey_is_member(p_table) then raise exception 'forbidden'; end if;
  select * into t from public.okey_tables where id = p_table;
  my_seat := public.okey_my_seat(p_table);
  if my_seat is not null then
    select tiles into hand from public.okey_hands where table_id = p_table and seat = my_seat;
  end if;
  select jsonb_build_object(
    'table', jsonb_build_object('id', t.id, 'name', t.name, 'mode', t.mode, 'status', t.status,
      'turn_seconds', t.turn_seconds, 'allow_viewers', t.allow_viewers,
      'livekit_room', t.livekit_room, 'host_id', t.host_id),
    'state', t.state,
    'players', (select jsonb_agg(jsonb_build_object('seat', p.seat, 'user_id', p.user_id, 'is_bot', p.is_bot,
        'team', p.team, 'score', p.score, 'connected', p.connected, 'hand_count',
        (select jsonb_array_length(h.tiles) from public.okey_hands h where h.table_id = p.table_id and h.seat = p.seat)))
      from public.okey_players p where p.table_id = p_table and p.left_at is null),
    'my_seat', my_seat,
    'my_hand', hand,
    'my_melds', (select melds from public.okey_hands where table_id = p_table and seat = my_seat),
    'is_viewer', my_seat is null
  ) into st;
  return st;
end $$;

-- Chat ----------------------------------------------------------------------
create or replace function public.okey_chat_send(p_table uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.okey_is_member(p_table) then raise exception 'forbidden'; end if;
  if length(trim(p_body)) = 0 or length(p_body) > 500 then raise exception 'bad_message'; end if;
  insert into public.okey_chat (table_id, user_id, body) values (p_table, auth.uid(), left(p_body,500));
end $$;

-- Invites -------------------------------------------------------------------
create or replace function public.okey_invite(p_table uuid, p_to uuid, p_seat int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  if auth.uid() is null or not public.okey_is_member(p_table) then raise exception 'forbidden'; end if;
  if p_to = auth.uid() then raise exception 'self_invite'; end if;
  insert into public.okey_invites (table_id, from_user, to_user, seat_hint)
  values (p_table, auth.uid(), p_to, p_seat) returning id into iid;
  perform public.notify_user(p_to, 'game_invite', 'Okey masasına davet',
    'Seni bir okey masasına davet etti', jsonb_build_object('table_id', p_table, 'kind','okey'));
  return iid;
end $$;

create or replace function public.okey_invite_respond(p_invite uuid, p_accept boolean)
returns int language plpgsql security definer set search_path = public as $$
declare inv public.okey_invites; seat int;
begin
  select * into inv from public.okey_invites where id = p_invite and to_user = auth.uid() for update;
  if inv.id is null then raise exception 'not_found'; end if;
  if inv.status <> 'pending' or inv.expires_at < now() then raise exception 'expired'; end if;
  if not p_accept then
    update public.okey_invites set status='declined' where id = p_invite; return -1;
  end if;
  update public.okey_invites set status='accepted' where id = p_invite;
  seat := public.okey_join_table(inv.table_id, null);
  return seat;
end $$;

-- RLS ------------------------------------------------------------------------
alter table public.okey_tables enable row level security;
alter table public.okey_players enable row level security;
alter table public.okey_hands enable row level security;
alter table public.okey_moves enable row level security;
alter table public.okey_chat enable row level security;
alter table public.okey_invites enable row level security;
alter table public.okey_viewers enable row level security;
alter table public.okey_stats enable row level security;

create policy "okey_tables_read" on public.okey_tables for select to authenticated
  using (public.okey_is_member(id) or public.is_moderator());
create policy "okey_tables_insert" on public.okey_tables for insert to authenticated with check (host_id = auth.uid());

create policy "okey_players_read" on public.okey_players for select to authenticated
  using (public.okey_is_member(table_id) or public.is_moderator());

-- Hands: only the seated player (or moderator via service) may read/write
create policy "okey_hands_read" on public.okey_hands for select to authenticated
  using (exists (select 1 from public.okey_players p where p.table_id = okey_hands.table_id
    and p.seat = okey_hands.seat and p.user_id = auth.uid() and p.left_at is null)
    or public.is_moderator());

create policy "okey_moves_read" on public.okey_moves for select to authenticated
  using (public.okey_is_member(table_id) or public.is_moderator());

create policy "okey_chat_read" on public.okey_chat for select to authenticated
  using (public.okey_is_member(table_id) or public.is_moderator());
create policy "okey_chat_insert" on public.okey_chat for insert to authenticated
  with check (user_id = auth.uid() and public.okey_is_member(table_id));

create policy "okey_invites_read" on public.okey_invites for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or public.is_moderator());
create policy "okey_invites_insert" on public.okey_invites for insert to authenticated
  with check (from_user = auth.uid() and public.okey_is_member(table_id));
create policy "okey_invites_update" on public.okey_invites for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());

create policy "okey_viewers_rw" on public.okey_viewers for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "okey_stats_read" on public.okey_stats for select to authenticated using (true);
create policy "okey_stats_update" on public.okey_stats for update to authenticated using (user_id = auth.uid());

-- Realtime
do $$ begin alter publication supabase_realtime add table public.okey_tables; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.okey_players; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.okey_chat; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.okey_invites; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.okey_moves; exception when others then null; end $$;
