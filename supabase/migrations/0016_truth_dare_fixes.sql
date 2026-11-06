-- Truth or Dare fixes: td_spin failed on an ambiguous "kind" reference, rejoin
-- hit the (room_id,user_id) unique key, code lookups were blocked by RLS, the
-- picked player could not choose truth/dare, custom questions leaked into the
-- global pool, and the host never handed over. Additive / replace-only.

alter table public.td_rounds alter column kind drop not null;
alter table public.td_rounds add column if not exists asked_by uuid references public.profiles(id) on delete set null;
alter table public.td_rounds drop constraint if exists td_rounds_status_check;
alter table public.td_rounds add constraint td_rounds_status_check
  check (status in ('choosing','pending','answered','passed','completed'));

-- user-written questions stay out of the shared pool
update public.td_questions set active = false where created_by is not null and body ? 'custom';

create or replace function public.td_pick_question(p_kind text, p_category text, p_game uuid)
returns public.td_questions language sql volatile security definer set search_path = public as $$
  select q.* from public.td_questions q
   where q.kind = p_kind and q.active and q.created_by is null
     and (p_category = 'arena' or q.risk <= 1)
     and q.id not in (select r.question_id from public.td_rounds r
                       where r.game_id = p_game and r.question_id is not null
                       order by r.created_at desc limit 30)
   order by gen_random_uuid() limit 1;
$$;

-- Spin: server picks the player (crypto-random, avoids repeating the last one).
-- The picked player then chooses truth or dare via td_choose.
create or replace function public.td_spin(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.td_rooms; g public.td_games; v_players uuid[]; v_pick uuid; v_n int; v_try int := 0; v_open int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.td_room_members where room_id = p_room and user_id = auth.uid()
                 and left_at is null and not is_spectator) then
    raise exception 'forbidden';
  end if;
  select * into r from public.td_rooms where id = p_room for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('waiting','playing') then raise exception 'not_playing'; end if;

  select * into g from public.td_games where room_id = p_room order by created_at desc limit 1;
  if g.id is null then
    insert into public.td_games (room_id) values (p_room) returning * into g;
  end if;
  select count(*) into v_open from public.td_rounds where game_id = g.id and status in ('choosing','pending');
  if v_open > 0 then raise exception 'round_in_progress'; end if;

  select array_agg(user_id order by seat) into v_players from public.td_room_members
   where room_id = p_room and not is_spectator and left_at is null and connected;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  loop
    v_pick := v_players[1 + (abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int) % v_n)];
    exit when v_try >= 6 or v_pick is distinct from (g.state->>'last_selected')::uuid;
    v_try := v_try + 1;
  end loop;

  update public.td_games set round_no = round_no + 1,
    state = jsonb_build_object('last_selected', v_pick, 'current_turn', v_pick, 'phase', 'choosing',
                               'round_no', round_no + 1, 'spun_by', auth.uid(), 'spun_at', now())
   where id = g.id returning * into g;
  insert into public.td_rounds (game_id, round_no, turn_user_id, kind, status, asked_by)
  values (g.id, g.round_no, v_pick, null, 'choosing', auth.uid());
  update public.td_rooms set status = 'playing', started_at = coalesce(started_at, now()) where id = p_room;
  return jsonb_build_object('game_id', g.id, 'round_no', g.round_no, 'turn_user', v_pick);
end $$;

create or replace function public.td_choose(p_round uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rd public.td_rounds; g public.td_games; r public.td_rooms; q public.td_questions;
begin
  if p_kind not in ('truth','dare') then raise exception 'bad_kind'; end if;
  select * into rd from public.td_rounds where id = p_round for update;
  if rd.id is null then raise exception 'not_found'; end if;
  if rd.turn_user_id <> auth.uid() then raise exception 'not_your_turn'; end if;
  if rd.status <> 'choosing' then raise exception 'already_chosen'; end if;
  select * into g from public.td_games where id = rd.game_id;
  select * into r from public.td_rooms where id = g.room_id;
  q := public.td_pick_question(p_kind, r.category, g.id);
  update public.td_rounds set kind = p_kind, question_id = q.id, status = 'pending' where id = p_round;
  update public.td_games set state = state || jsonb_build_object('phase', 'answering', 'kind', p_kind) where id = g.id;
  return jsonb_build_object('kind', p_kind, 'question', q.body);
end $$;

-- "Kendi Sorumu Sor": another player replaces the pooled question for this round only.
create or replace function public.td_ask_custom(p_round uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare rd public.td_rounds; g public.td_games; r public.td_rooms; b text := trim(coalesce(p_body, ''));
begin
  select * into rd from public.td_rounds where id = p_round for update;
  if rd.id is null then raise exception 'not_found'; end if;
  select * into g from public.td_games where id = rd.game_id;
  select * into r from public.td_rooms where id = g.room_id;
  if not exists (select 1 from public.td_room_members where room_id = r.id and user_id = auth.uid()
                 and left_at is null and not is_spectator) then raise exception 'forbidden'; end if;
  if not r.allow_user_questions then raise exception 'user_questions_disabled'; end if;
  if rd.turn_user_id = auth.uid() then raise exception 'cannot_ask_self'; end if;
  if rd.status <> 'pending' or rd.custom_text is not null then raise exception 'round_closed'; end if;
  if length(b) < 5 or length(b) > 300 then raise exception 'bad_length'; end if;
  if b ~* '(child|minor|underage|loli|shota|csam|çocuk|reşit|nude|naked|çıplak|sex with|kill yourself|suicide|intihar|kendini öldür|adres|address|password|şifre)' then
    raise exception 'prohibited_content';
  end if;
  update public.td_rounds set custom_text = b, asked_by = auth.uid() where id = p_round;
end $$;

-- legacy entry point: no longer feeds the shared pool
create or replace function public.td_submit_content(p_kind text, p_body text, p_room uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare rd uuid;
begin
  select rd2.id into rd from public.td_rounds rd2 join public.td_games g on g.id = rd2.game_id
   where g.room_id = p_room and rd2.status = 'pending' order by rd2.created_at desc limit 1;
  if rd is null then raise exception 'no_open_round'; end if;
  perform public.td_ask_custom(rd, p_body);
  return rd;
end $$;

create or replace function public.td_resolve_round(p_round uuid, p_status text, p_evidence_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare rd public.td_rounds; v_room uuid;
begin
  select * into rd from public.td_rounds where id = p_round for update;
  if rd.id is null then raise exception 'not_found'; end if;
  if p_status not in ('answered','passed','completed') then raise exception 'bad_status'; end if;
  select room_id into v_room from public.td_games where id = rd.game_id;
  if auth.uid() <> rd.turn_user_id and not public.is_moderator()
     and not exists (select 1 from public.td_rooms where id = v_room and host_id = auth.uid()) then
    raise exception 'not_your_turn';
  end if;
  if rd.status not in ('choosing','pending') then return; end if; -- idempotent
  update public.td_rounds set status = p_status, resolved_at = now(), evidence_id = coalesce(p_evidence_id, evidence_id)
   where id = p_round;
  update public.td_games set state = state || jsonb_build_object('phase', 'idle') where id = rd.game_id;
  -- passing is never penalised; finishing gives the same xp regardless of risk
  if p_status in ('answered','completed') then
    insert into public.td_user_stats (user_id) values (rd.turn_user_id) on conflict do nothing;
    update public.td_user_stats set
      dares_completed = dares_completed + case when rd.kind = 'dare' then 1 else 0 end,
      truths_answered = truths_answered + case when rd.kind = 'truth' then 1 else 0 end,
      xp = xp + 10, level = 1 + (xp + 10) / 200, updated_at = now()
    where user_id = rd.turn_user_id;
  end if;
end $$;

create or replace function public.td_join_room(p_room uuid, p_password text default null, p_as_spectator boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.td_rooms; m public.td_room_members; v_seat int; v_cnt int; v_spec int; v_id uuid; v_as_spec boolean;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into r from public.td_rooms where id = p_room for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status = 'closed' then raise exception 'closed'; end if;
  select * into m from public.td_room_members where room_id = p_room and user_id = auth.uid();
  if m.id is not null and m.left_at is null then
    update public.td_room_members set connected = true, last_seen_at = now() where id = m.id;
    return m.id;
  end if;
  if r.password_hash is not null and (p_password is null or encode(digest(p_password,'sha256'),'hex') <> r.password_hash) then
    raise exception 'bad_password';
  end if;
  if exists (select 1 from public.user_blocks b join public.td_room_members x on x.room_id = p_room and x.left_at is null
              where (b.blocker_id = auth.uid() and b.blocked_id = x.user_id) or (b.blocker_id = x.user_id and b.blocked_id = auth.uid())) then
    raise exception 'blocked';
  end if;

  select count(*) into v_cnt from public.td_room_members where room_id = p_room and not is_spectator and left_at is null;
  v_as_spec := coalesce(p_as_spectator, false) or v_cnt >= r.capacity;
  if v_as_spec then
    if not r.allow_spectators then
      if coalesce(p_as_spectator, false) then raise exception 'spectators_disabled'; else raise exception 'room_full'; end if;
    end if;
    select count(*) into v_spec from public.td_room_members where room_id = p_room and is_spectator and left_at is null;
    if v_spec >= r.max_spectators then raise exception 'spectator_limit'; end if;
    v_seat := null;
  else
    select s into v_seat from generate_series(0, r.capacity - 1) s
     where not exists (select 1 from public.td_room_members x where x.room_id = p_room and x.seat = s and x.left_at is null)
     order by s limit 1;
  end if;

  if m.id is not null then
    update public.td_room_members set left_at = null, connected = true, last_seen_at = now(), seat = v_seat,
      role = case when v_as_spec then 'spectator' else 'player' end, is_spectator = v_as_spec, is_ready = false
     where id = m.id returning id into v_id;
  else
    insert into public.td_room_members (room_id, user_id, seat, role, is_spectator)
    values (p_room, auth.uid(), v_seat, case when v_as_spec then 'spectator' else 'player' end, v_as_spec)
    returning id into v_id;
  end if;
  insert into public.td_user_stats (user_id) values (auth.uid()) on conflict do nothing;
  update public.td_user_stats set games_played = games_played + 1 where user_id = auth.uid() and not v_as_spec;
  return v_id;
end $$;

create or replace function public.td_leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.td_rooms; nh uuid;
begin
  select * into r from public.td_rooms where id = p_room for update;
  if r.id is null then return; end if;
  update public.td_room_members set left_at = now(), connected = false, is_ready = false
   where room_id = p_room and user_id = auth.uid() and left_at is null;
  -- an open round of the leaver is closed as passed (no penalty)
  update public.td_rounds set status = 'passed', resolved_at = now()
   where turn_user_id = auth.uid() and status in ('choosing','pending')
     and game_id in (select id from public.td_games where room_id = p_room);
  if r.host_id = auth.uid() then
    select user_id into nh from public.td_room_members
     where room_id = p_room and left_at is null and not is_spectator order by joined_at limit 1;
    if nh is null then
      update public.td_rooms set status = 'closed', finished_at = now() where id = p_room;
    else
      update public.td_rooms set host_id = nh where id = p_room;
      update public.td_room_members set role = 'host' where room_id = p_room and user_id = nh and left_at is null;
    end if;
  end if;
end $$;

create or replace function public.td_find_room(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'room', r.livekit_room, 'name', r.name, 'status', r.status,
    'has_password', r.password_hash is not null, 'allow_spectators', r.allow_spectators, 'category', r.category)
    from public.td_rooms r
   where (r.id::text = trim(p_code) or r.livekit_room = trim(p_code)) and r.status <> 'closed'
   limit 1;
$$;

create or replace function public.td_quick_join(p_category text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  for r in
    select x.id, x.livekit_room from public.td_rooms x
     where x.status in ('waiting','playing') and x.password_hash is null and not x.is_private
       and (p_category is null or x.category = p_category)
       and x.created_at > now() - interval '6 hours'
       and (select count(*) from public.td_room_members m where m.room_id = x.id and not m.is_spectator and m.left_at is null) < x.capacity
     order by x.created_at desc limit 20
  loop
    begin
      perform public.td_join_room(r.id, null, false);
      return jsonb_build_object('id', r.id, 'room', r.livekit_room);
    exception when others then continue;
    end;
  end loop;
  return null;
end $$;

create or replace function public.td_invite(p_room uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.td_rooms; recent int;
begin
  if auth.uid() is null or not public.td_is_member(p_room) then raise exception 'forbidden'; end if;
  if p_to = auth.uid() then raise exception 'self_invite'; end if;
  select count(*) into recent from public.td_room_invites where from_user = auth.uid() and created_at > now() - interval '1 minute';
  if recent >= 10 then raise exception 'rate_limited'; end if;
  select * into r from public.td_rooms where id = p_room;
  insert into public.td_room_invites (room_id, from_user, to_user) values (p_room, auth.uid(), p_to)
  on conflict (room_id, to_user) do update set status = 'pending', expires_at = now() + interval '15 minutes', from_user = auth.uid();
  perform public.notify_user(p_to, 'game_invite', 'Doğruluk mu Cesaret mi daveti',
    'Seni "' || r.name || '" odasına davet etti', jsonb_build_object('room_id', p_room, 'kind', 'td'), auth.uid());
end $$;

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
      'host_id', r.host_id, 'is_private', r.is_private, 'max_spectators', r.max_spectators),
    'game', case when g.id is null then null else jsonb_build_object('id', g.id, 'round_no', g.round_no, 'state', g.state) end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'seat', m.seat, 'role', m.role,
        'is_spectator', m.is_spectator, 'is_ready', m.is_ready, 'mic_on', m.mic_on, 'cam_on', m.cam_on,
        'connected', m.connected, 'profile', (select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url) from public.profiles p where p.id = m.user_id))
        order by m.is_spectator, m.seat), '[]'::jsonb)
      from public.td_room_members m where m.room_id = p_room and m.left_at is null),
    'my_role', my_role,
    'current_round', (select jsonb_build_object('id', rd.id, 'round_no', rd.round_no, 'kind', rd.kind, 'status', rd.status,
        'question', (select q.body from public.td_questions q where q.id = rd.question_id),
        'custom_text', rd.custom_text, 'asked_by', rd.asked_by, 'turn_user_id', rd.turn_user_id, 'evidence_id', rd.evidence_id,
        'my_evidence_viewed', (select er.consumed_at is not null from public.td_evidence_recipients er
                                where er.evidence_id = rd.evidence_id and er.user_id = auth.uid()),
        'can_view_evidence', exists (select 1 from public.td_evidence_recipients er
                                where er.evidence_id = rd.evidence_id and er.user_id = auth.uid()))
      from public.td_rounds rd where rd.game_id = g.id order by rd.round_no desc limit 1)
  );
end $$;

grant execute on function public.td_choose(uuid, text) to authenticated;
grant execute on function public.td_ask_custom(uuid, text) to authenticated;
grant execute on function public.td_find_room(text) to authenticated;
grant execute on function public.td_quick_join(text) to authenticated;
grant execute on function public.td_invite(uuid, uuid) to authenticated;
revoke all on function public.td_pick_question(text, text, uuid) from public, anon, authenticated;
