-- Truth or Dare: rooms, members, games, rounds, content, evidence (view-once), chat, stats, likes/matches
create table if not exists public.td_rooms (
  id uuid primary key default gen_random_uuid(),
  livekit_room text not null unique,
  name text not null default 'Neon Lounge',
  category text not null default 'friends' check (category in ('flirt','couples','friends','arena','global')),
  status text not null default 'waiting' check (status in ('waiting','playing','finished','closed')),
  host_id uuid not null references public.profiles(id),
  capacity int not null default 6 check (capacity in (4,6,8)),
  allow_spectators boolean not null default true,
  allow_user_questions boolean not null default true,
  allow_camera boolean not null default true,
  voice_enabled boolean not null default true,
  is_private boolean not null default false,
  password_hash text,
  max_spectators int not null default 30,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.td_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.td_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seat int,
  role text not null default 'player' check (role in ('host','player','spectator')),
  is_ready boolean not null default false,
  is_spectator boolean not null default false,
  mic_on boolean not null default false,
  cam_on boolean not null default false,
  connected boolean not null default true,
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (room_id, user_id)
);
create index if not exists td_members_room_idx on public.td_room_members (room_id) where left_at is null;

create table if not exists public.td_room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.td_rooms(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  unique (room_id, to_user)
);

create table if not exists public.td_questions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('truth','dare')),
  category text not null default 'general',
  body jsonb not null, -- {"tr": "...", "en": "...", "es": "...", "ar": "..."}
  risk int not null default 0, -- 0 normal, 1 suggestive, 2 edgy (filtered per room category)
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists td_questions_kind_idx on public.td_questions (kind, active);

create table if not exists public.td_games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.td_rooms(id) on delete cascade,
  round_no int not null default 0,
  state jsonb not null default '{}'::jsonb, -- {current_turn, selected_user, kind, question_id, status, bottle_rotation...}
  created_at timestamptz not null default now()
);

create table if not exists public.td_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.td_games(id) on delete cascade,
  round_no int not null,
  turn_user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('truth','dare')),
  question_id uuid references public.td_questions(id),
  custom_text text,
  status text not null default 'pending' check (status in ('pending','answered','passed','completed')),
  evidence_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists td_rounds_game_idx on public.td_rounds (game_id, round_no);

-- View-once media evidence
create table if not exists public.td_evidence (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.td_rounds(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  storage_path text not null,      -- R2 key
  media_type text not null check (media_type in ('photo','video')),
  mime text,
  size_bytes bigint,
  duration_ms int,
  created_at timestamptz not null default now()
);

create table if not exists public.td_evidence_recipients (
  evidence_id uuid not null references public.td_evidence(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  consumed_at timestamptz,
  primary key (evidence_id, user_id)
);

create table if not exists public.td_chat (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.td_rooms(id) on delete cascade,
  game_id uuid references public.td_games(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.td_user_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games_played int not null default 0,
  games_completed int not null default 0,
  dares_completed int not null default 0,
  truths_answered int not null default 0,
  xp int not null default 0,
  level int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.td_likes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.td_rooms(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, from_user, to_user),
  check (from_user <> to_user)
);

create table if not exists public.td_matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  room_id uuid references public.td_rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

-- helpers --------------------------------------------------------------------
create or replace function public.td_my_membership(p_room uuid, p_user uuid default auth.uid())
returns public.td_room_members language sql stable security definer set search_path = public as $$
  select * from public.td_room_members
   where room_id = p_room and user_id = p_user and left_at is null limit 1;
$$;

create or replace function public.td_is_member(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.td_room_members where room_id = p_room and user_id = p_user and left_at is null)
      or public.is_moderator();
$$;

create or replace function public.td_create_room(
  p_room_name text, p_category text, p_capacity int, p_is_private boolean,
  p_password text, p_allow_spectators boolean, p_allow_user_questions boolean,
  p_allow_camera boolean, p_voice_enabled boolean
) returns public.td_rooms
language plpgsql security definer set search_path = public as $$
declare r public.td_rooms;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_capacity not in (4,6,8) then raise exception 'bad_capacity'; end if;
  if p_category not in ('flirt','couples','friends','arena','global') then raise exception 'bad_category'; end if;
  insert into public.td_rooms (livekit_room, name, category, host_id, capacity, is_private,
    password_hash, allow_spectators, allow_user_questions, allow_camera, voice_enabled)
  values (p_room_name, left(coalesce(p_room_name,'Neon Lounge'),60), p_category, auth.uid(),
    p_capacity, coalesce(p_is_private,false),
    case when p_password is null or p_password='' then null else encode(digest(p_password,'sha256'),'hex') end,
    coalesce(p_allow_spectators,true), coalesce(p_allow_user_questions,true),
    coalesce(p_allow_camera,true), coalesce(p_voice_enabled,true))
  returning * into r;
  insert into public.td_room_members (room_id, user_id, seat, role, is_ready)
  values (r.id, auth.uid(), 0, 'host', true);
  insert into public.td_user_stats (user_id) values (auth.uid()) on conflict do nothing;
  return r;
end $$;

create or replace function public.td_join_room(p_room uuid, p_password text default null, p_as_spectator boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.td_rooms; m public.td_room_members; seat int; cnt int; spec_cnt int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into r from public.td_rooms where id = p_room for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status = 'closed' then raise exception 'closed'; end if;
  if r.password_hash is not null and (p_password is null or encode(digest(p_password,'sha256'),'hex') <> r.password_hash) then
    raise exception 'bad_password';
  end if;
  select * into m from public.td_room_members where room_id = p_room and user_id = auth.uid() and left_at is null;
  if m.id is not null then
    update public.td_room_members set connected = true, last_seen_at = now() where id = m.id;
    return m.id;
  end if;
  if p_as_spectator or r.status = 'playing' then
    if not r.allow_spectators then raise exception 'spectators_disabled'; end if;
    select count(*) into spec_cnt from public.td_room_members where room_id = p_room and is_spectator and left_at is null;
    if spec_cnt >= r.max_spectators then raise exception 'spectator_limit'; end if;
    insert into public.td_room_members (room_id, user_id, role, is_spectator)
    values (p_room, auth.uid(), 'spectator', true) returning id into m.id;
    return m.id;
  end if;
  select count(*) into cnt from public.td_room_members where room_id = p_room and not is_spectator and left_at is null;
  if cnt >= r.capacity then raise exception 'room_full'; end if;
  select s into seat from generate_series(0, r.capacity-1) s
   where not exists (select 1 from public.td_room_members where room_id = p_room and seat = s and left_at is null)
   order by s limit 1;
  insert into public.td_room_members (room_id, user_id, seat, role)
  values (p_room, auth.uid(), seat, 'player') returning id into m.id;
  insert into public.td_user_stats (user_id) values (auth.uid()) on conflict do nothing;
  return m.id;
end $$;

create or replace function public.td_leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.td_room_members set left_at = now(), connected = false
   where room_id = p_room and user_id = auth.uid() and left_at is null;
end $$;

create or replace function public.td_set_ready(p_room uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.td_room_members set is_ready = p_ready
   where room_id = p_room and user_id = auth.uid() and left_at is null;
end $$;

-- Spin: cryptographically fair pick of player + truth/dare + question.
-- Avoids immediate repeat of same player via state.last_selected.
create or replace function public.td_spin(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.td_rooms; g public.td_games; players uuid[]; pick_user uuid;
  kind text; q public.td_questions; rnd bytea; attempts int := 0;
begin
  if auth.uid() is null or not public.td_is_member(p_room) then raise exception 'forbidden'; end if;
  select * into r from public.td_rooms where id = p_room for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('waiting','playing') then raise exception 'not_playing'; end if;
  -- ensure a game row exists
  select * into g from public.td_games where room_id = p_room order by created_at desc limit 1;
  if g.id is null then
    insert into public.td_games (room_id) values (p_room) returning * into g;
    update public.td_rooms set status='playing', started_at=coalesce(started_at, now()) where id=p_room;
  end if;
  select array_agg(user_id) into players from public.td_room_members
   where room_id = p_room and not is_spectator and left_at is null and connected;
  if coalesce(array_length(players,1),0) < 2 then raise exception 'not_enough_players'; end if;
  -- fair random: bytes -> index, retry to avoid same player twice in a row
  loop
    rnd := gen_random_bytes(4);
    pick_user := players[1 + (get_byte(rnd,0)::int + get_byte(rnd,1)*256 + get_byte(rnd,2)*65536 + get_byte(rnd,3)*16777216) % array_length(players,1)];
    exit when attempts > 5 or pick_user is distinct from (g.state->>'last_selected')::uuid;
    attempts := attempts + 1;
  end loop;
  kind := case when get_byte(gen_random_bytes(1),0) % 2 = 0 then 'truth' else 'dare' end;
  -- pick a question from pool matching room category risk ceiling
  select * into q from public.td_questions
   where kind = kind and active
     and (r.category = 'arena' or risk <= 1)
   order by random() limit 1;
  if q.id is null then raise exception 'no_questions'; end if;
  -- avoid recently used questions (last 30 rounds)
  select * into q from public.td_questions
   where kind = kind and active and id <> q.id
     and (r.category = 'arena' or risk <= 1)
     and id not in (select question_id from public.td_rounds where game_id = g.id and question_id is not null order by created_at desc limit 30)
   order by random() limit 1;
  update public.td_games set
    round_no = round_no + 1,
    state = jsonb_build_object('current_turn', pick_user, 'last_selected', pick_user,
      'kind', kind, 'question_id', q.id, 'phase','choosing','round_no', round_no+1)
  where id = g.id returning * into g;
  insert into public.td_rounds (game_id, round_no, turn_user_id, kind, question_id)
  values (g.id, g.round_no, pick_user, kind, q.id);
  update public.td_rooms set status='playing' where id=p_room;
  return jsonb_build_object('game_id', g.id, 'round_no', g.round_no, 'turn_user', pick_user,
    'kind', kind, 'question', q.body, 'category', r.category);
end $$;

-- Answer/skip/completed
create or replace function public.td_resolve_round(p_round uuid, p_status text, p_evidence_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare rd public.td_rounds;
begin
  select * into rd from public.td_rounds where id = p_round;
  if rd.id is null then raise exception 'not_found'; end if;
  if not (public.td_is_member((select room_id from public.td_games where id = rd.game_id)) or public.is_moderator()) then
    raise exception 'forbidden';
  end if;
  if p_status not in ('answered','passed','completed') then raise exception 'bad_status'; end if;
  -- only the turn user (or host/moderator) can resolve
  if auth.uid() <> rd.turn_user_id and not public.is_moderator() then
    if not exists (select 1 from public.td_room_members m join public.td_rooms r on r.id = m.room_id
                   where r.id = (select room_id from public.td_games where id = rd.game_id)
                     and m.user_id = auth.uid() and m.role='host' and m.left_at is null) then
      raise exception 'not_your_turn';
    end if;
  end if;
  update public.td_rounds set status = p_status, resolved_at = now(), evidence_id = coalesce(p_evidence_id, evidence_id)
   where id = p_round;
  if p_status = 'completed' then
    update public.td_user_stats set
      dares_completed = dares_completed + case when rd.kind='dare' then 1 else 0 end,
      truths_answered = truths_answered + case when rd.kind='truth' then 1 else 0 end,
      xp = xp + 10, updated_at = now()
    where user_id = rd.turn_user_id;
  end if;
end $$;

-- Custom question/dare submission (user-generated, moderated flag)
create or replace function public.td_submit_content(p_kind text, p_body text, p_room uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare qid uuid; r public.td_rooms;
begin
  if auth.uid() is null or not public.td_is_member(p_room) then raise exception 'forbidden'; end if;
  select * into r from public.td_rooms where id = p_room;
  if not r.allow_user_questions then raise exception 'user_questions_disabled'; end if;
  if length(trim(p_body)) < 5 or length(p_body) > 300 then raise exception 'bad_length'; end if;
  -- basic safety filter: block obvious CSAM/illegal keywords (server-side)
  if p_body ~* '(child|minor|underage|loli|shota|csam|nude|naked|sex with|kill yourself|suicide)' then
    raise exception 'prohibited_content';
  end if;
  insert into public.td_questions (kind, category, body, risk, active, created_by)
  values (p_kind, r.category, jsonb_build_object('custom', left(p_body,300), 'author', auth.uid()), 1, true, auth.uid())
  returning id into qid;
  return qid;
end $$;

-- Evidence upload record (actual bytes go through media-upload-url -> R2)
create or replace function public.td_create_evidence(p_round uuid, p_storage_path text, p_media_type text, p_mime text, p_size bigint, p_duration int, p_recipients uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rd public.td_rounds; eid uuid; rid uuid; uid uuid;
begin
  select * into rd from public.td_rounds where id = p_round;
  if rd.id is null then raise exception 'not_found'; end if;
  rid := (select room_id from public.td_games where id = rd.game_id);
  if auth.uid() <> rd.turn_user_id and not public.is_moderator() then raise exception 'not_your_round'; end if;
  if not public.td_is_member(rid) then raise exception 'forbidden'; end if;
  insert into public.td_evidence (round_id, uploader_id, storage_path, media_type, mime, size_bytes, duration_ms)
  values (p_round, auth.uid(), p_storage_path, p_media_type, p_mime, p_size, p_duration)
  returning id into eid;
  foreach uid in array coalesce(p_recipients, '{}') loop
    if exists (select 1 from public.td_room_members where room_id = rid and user_id = uid and left_at is null) then
      insert into public.td_evidence_recipients (evidence_id, user_id) values (eid, uid)
        on conflict do nothing;
    end if;
  end loop;
  -- uploader can always view own
  insert into public.td_evidence_recipients (evidence_id, user_id) values (eid, auth.uid()) on conflict do nothing;
  update public.td_rounds set evidence_id = eid where id = p_round;
  return eid;
end $$;

-- View-once: atomically consume a view right and return a fresh signed URL request marker
create or replace function public.td_view_evidence(p_evidence uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev public.td_evidence; rd public.td_rounds; rid uuid; consumed timestamptz;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into ev from public.td_evidence where id = p_evidence;
  if ev.id is null then raise exception 'not_found'; end if;
  select * into rd from public.td_rounds where id = ev.round_id;
  rid := (select room_id from public.td_games where id = rd.game_id);
  if not public.td_is_member(rid) then raise exception 'forbidden'; end if;
  update public.td_evidence_recipients set consumed_at = now()
   where evidence_id = p_evidence and user_id = auth.uid() and consumed_at is null
   returning consumed_at into consumed;
  if consumed is null then
    -- already consumed or not a recipient
    if not exists (select 1 from public.td_evidence_recipients where evidence_id = p_evidence and user_id = auth.uid()) then
      raise exception 'not_recipient';
    end if;
    raise exception 'already_viewed';
  end if;
  return jsonb_build_object('storage_path', ev.storage_path, 'media_type', ev.media_type, 'mime', ev.mime);
end $$;

-- Chat ----------------------------------------------------------------------
create or replace function public.td_chat_send(p_room uuid, p_body text, p_game uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.td_is_member(p_room) then raise exception 'forbidden'; end if;
  if length(trim(p_body)) = 0 or length(p_body) > 500 then raise exception 'bad_message'; end if;
  insert into public.td_chat (room_id, game_id, user_id, body) values (p_room, p_game, auth.uid(), left(p_body,500));
end $$;

-- Likes / matches -------------------------------------------------------------
create or replace function public.td_like(p_room uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare matched boolean;
begin
  if auth.uid() is null or not public.td_is_member(p_room) then raise exception 'forbidden'; end if;
  if p_to = auth.uid() then raise exception 'self_like'; end if;
  if exists (select 1 from public.user_blocks where (blocker_id = auth.uid() and blocked_id = p_to) or (blocker_id = p_to and blocked_id = auth.uid())) then
    raise exception 'blocked';
  end if;
  insert into public.td_likes (room_id, from_user, to_user) values (p_room, auth.uid(), p_to) on conflict do nothing;
  select exists (select 1 from public.td_likes where room_id = p_room and from_user = p_to and to_user = auth.uid()) into matched;
  if matched then
    insert into public.td_matches (user_a, user_b, room_id)
    values (least(auth.uid(), p_to), greatest(auth.uid(), p_to), p_room) on conflict do nothing;
    perform public.notify_user(p_to, 'match', 'Yeni eşleşme!', 'Birisi seni beğendi', jsonb_build_object('room_id', p_room, 'kind','td_match'), auth.uid());
  end if;
end $$;

-- Public room state (no secrets; hands n/a here)
create or replace function public.td_state(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.td_rooms; g public.td_games; my_role text;
begin
  if auth.uid() is null or not public.td_is_member(p_room) then raise exception 'forbidden'; end if;
  select * into r from public.td_rooms where id = p_room;
  select * into g from public.td_games where room_id = p_room order by created_at desc limit 1;
  select role into my_role from public.td_room_members where room_id = p_room and user_id = auth.uid() and left_at is null;
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'name', r.name, 'category', r.category, 'status', r.status,
      'capacity', r.capacity, 'allow_spectators', r.allow_spectators, 'allow_user_questions', r.allow_user_questions,
      'allow_camera', r.allow_camera, 'voice_enabled', r.voice_enabled, 'livekit_room', r.livekit_room,
      'host_id', r.host_id, 'is_private', r.is_private),
    'game', case when g.id is null then null else jsonb_build_object('id', g.id, 'round_no', g.round_no, 'state', g.state) end,
    'members', (select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'seat', m.seat, 'role', m.role,
        'is_spectator', m.is_spectator, 'is_ready', m.is_ready, 'mic_on', m.mic_on, 'cam_on', m.cam_on,
        'connected', m.connected, 'profile', (select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) from public.profiles p where p.id = m.user_id)))
      from public.td_room_members m where m.room_id = p_room and m.left_at is null),
    'my_role', my_role,
    'current_round', (select jsonb_build_object('id', rd.id, 'kind', rd.kind, 'status', rd.status,
        'question', (select q.body from public.td_questions q where q.id = rd.question_id),
        'custom_text', rd.custom_text, 'turn_user_id', rd.turn_user_id, 'evidence_id', rd.evidence_id)
      from public.td_rounds rd where rd.game_id = g.id order by rd.round_no desc limit 1)
  );
end $$;

-- RLS ------------------------------------------------------------------------
alter table public.td_rooms enable row level security;
alter table public.td_room_members enable row level security;
alter table public.td_room_invites enable row level security;
alter table public.td_questions enable row level security;
alter table public.td_games enable row level security;
alter table public.td_rounds enable row level security;
alter table public.td_evidence enable row level security;
alter table public.td_evidence_recipients enable row level security;
alter table public.td_chat enable row level security;
alter table public.td_user_stats enable row level security;
alter table public.td_likes enable row level security;
alter table public.td_matches enable row level security;

create policy "td_rooms_read" on public.td_rooms for select to authenticated
  using (public.td_is_member(id) or public.is_moderator());
create policy "td_rooms_insert" on public.td_rooms for insert to authenticated with check (host_id = auth.uid());
create policy "td_rooms_update" on public.td_rooms for update to authenticated
  using (host_id = auth.uid() or public.is_moderator()) with check (host_id = auth.uid() or public.is_moderator());

create policy "td_members_read" on public.td_room_members for select to authenticated
  using (public.td_is_member(room_id) or user_id = auth.uid() or public.is_moderator());

create policy "td_invites_read" on public.td_room_invites for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or public.is_moderator());
create policy "td_invites_insert" on public.td_room_invites for insert to authenticated
  with check (from_user = auth.uid() and public.td_is_member(room_id));
create policy "td_invites_update" on public.td_room_invites for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());

create policy "td_questions_read" on public.td_questions for select to authenticated using (active or public.is_moderator());
create policy "td_questions_write_mod" on public.td_questions for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator() or created_by = auth.uid());

create policy "td_games_read" on public.td_games for select to authenticated
  using (public.td_is_member(room_id) or public.is_moderator());

create policy "td_rounds_read" on public.td_rounds for select to authenticated
  using (exists (select 1 from public.td_games g where g.id = game_id and public.td_is_member(g.room_id)) or public.is_moderator());

-- Evidence: metadata visible to room members; actual bytes via signed URL only after td_view_evidence
create policy "td_evidence_read" on public.td_evidence for select to authenticated
  using (exists (select 1 from public.td_rounds rd join public.td_games g on g.id = rd.game_id
    where rd.id = round_id and public.td_is_member(g.room_id)) or public.is_moderator());

create policy "td_evidence_recipients_read" on public.td_evidence_recipients for select to authenticated
  using (user_id = auth.uid() or public.is_moderator());

create policy "td_chat_read" on public.td_chat for select to authenticated
  using (public.td_is_member(room_id) or public.is_moderator());
create policy "td_chat_insert" on public.td_chat for insert to authenticated
  with check (user_id = auth.uid() and public.td_is_member(room_id));

create policy "td_stats_read" on public.td_user_stats for select to authenticated using (true);
create policy "td_stats_update" on public.td_user_stats for update to authenticated using (user_id = auth.uid());

create policy "td_likes_rw" on public.td_likes for all to authenticated
  using (from_user = auth.uid() or public.is_moderator()) with check (from_user = auth.uid());

create policy "td_matches_read" on public.td_matches for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid() or public.is_moderator());

-- Realtime
do $$ begin alter publication supabase_realtime add table public.td_rooms; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.td_room_members; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.td_chat; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.td_room_invites; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.td_games; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.td_rounds; exception when others then null; end $$;
