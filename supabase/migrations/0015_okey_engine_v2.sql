-- Okey engine v2: correct dealing (1-based arrays, indicator/okey), bot seat
-- fill, private stock, atomic server commits, seat reclaim, quick join.
-- Additive / replace-function only: no user data is dropped.

create table if not exists public.okey_secrets (
  table_id uuid primary key references public.okey_tables(id) on delete cascade,
  stock jsonb not null default '[]'::jsonb
);
alter table public.okey_secrets enable row level security; -- no policies: service role only

alter table public.okey_players add column if not exists bot_for uuid references public.profiles(id) on delete set null;

-- the stock used to live in the public state row (visible via realtime) — strip it
update public.okey_tables set state = state - 'stock' where state ? 'stock';

drop function if exists public.okey_start(uuid);

create or replace function public.okey_start(p_table uuid, p_fill_bots boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.okey_tables; n int; deck int[]; pos int := 1; s int; starter int; cnt int;
  ind int := null; ok_color int; ok_num int; stock int[]; i int; st jsonb;
begin
  select * into t from public.okey_tables where id = p_table for update;
  if t.id is null then raise exception 'not_found'; end if;
  if t.host_id <> auth.uid() then raise exception 'forbidden'; end if;
  if t.status not in ('waiting','finished') then raise exception 'already_started'; end if;

  delete from public.okey_players where table_id = p_table and left_at is not null;
  select count(*) into n from public.okey_players where table_id = p_table and left_at is null;
  if n < 4 then
    if not coalesce(p_fill_bots, true) then raise exception 'need_4_players'; end if;
    insert into public.okey_players (table_id, seat, is_bot, team)
    select p_table, g, true, case when t.mode = 'pairs' then g % 2 end
      from generate_series(0,3) g
     where not exists (select 1 from public.okey_players p where p.table_id = p_table and p.seat = g);
  end if;

  deck := array(select g from generate_series(0,105) g order by gen_random_uuid());
  select g into starter from generate_series(0,3) g order by gen_random_uuid() limit 1;

  for s in 0..3 loop
    cnt := case when s = starter then 15 else 14 end;
    insert into public.okey_hands (table_id, seat, tiles, melds)
    values (p_table, s, to_jsonb(deck[pos:pos+cnt-1]), '[]'::jsonb)
    on conflict (table_id, seat) do update set tiles = excluded.tiles, melds = '[]'::jsonb;
    pos := pos + cnt;
  end loop;

  for i in pos..array_length(deck,1) loop
    if deck[i] < 104 then ind := deck[i]; exit; end if;
  end loop;
  stock := array(select x from unnest(deck[pos:array_length(deck,1)]) with ordinality u(x, o) where x <> ind order by o);
  ok_color := ind / 26;
  ok_num := case when ind % 13 + 1 = 13 then 1 else ind % 13 + 2 end;

  insert into public.okey_secrets (table_id, stock) values (p_table, to_jsonb(stock))
  on conflict (table_id) do update set stock = excluded.stock;

  st := jsonb_build_object(
    'phase', 'discard',
    'turn_seat', starter,
    'turn_started_at', now(),
    'turn_seconds', t.turn_seconds,
    'stock_count', coalesce(array_length(stock,1),0),
    'discards', '{"0":[],"1":[],"2":[],"3":[]}'::jsonb,
    'indicator', ind,
    'okey', jsonb_build_object('color', ok_color, 'num', ok_num),
    'round', coalesce((t.state->>'round')::int, 0) + 1,
    'last_move', null,
    'result', null
  );
  update public.okey_tables
     set status = 'playing', started_at = now(), finished_at = null, winner_seat = null,
         state = st, version = coalesce(version,0) + 1
   where id = p_table;
  insert into public.okey_moves (table_id, seat, type, payload)
  values (p_table, null, 'game_start', jsonb_build_object('mode', t.mode, 'starter', starter, 'round', st->'round'));
end $$;

-- Atomic server-side commit used by the okey-action Edge Function.
create or replace function public.okey_commit(
  p_table uuid, p_version int, p_state jsonb, p_stock jsonb, p_hands jsonb, p_moves jsonb, p_result jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare t public.okey_tables; k text; r record; d int;
begin
  update public.okey_tables
     set state = p_state, version = version + 1,
         status = case when p_result is not null then 'finished' else status end,
         finished_at = case when p_result is not null then now() else finished_at end,
         winner_seat = case when p_result is not null then (p_result->>'winner_seat')::int else winner_seat end
   where id = p_table and version = p_version and status = 'playing'
  returning * into t;
  if t.id is null then return false; end if;

  if p_stock is not null then
    update public.okey_secrets set stock = p_stock where table_id = p_table;
  end if;
  for k in select jsonb_object_keys(coalesce(p_hands, '{}'::jsonb)) loop
    update public.okey_hands set tiles = p_hands->k where table_id = p_table and seat = k::int;
  end loop;
  insert into public.okey_moves (table_id, seat, type, payload)
  select p_table, (m->>'seat')::int, m->>'type', coalesce(m->'payload', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m;

  if p_result is not null then
    for r in select * from public.okey_players where table_id = p_table and left_at is null loop
      d := coalesce((p_result->'deltas'->>(r.seat::text))::int, 0);
      update public.okey_players set score = score + d where id = r.id;
      if r.user_id is not null and not r.is_bot and p_result->>'kind' = 'win' then
        perform public.okey_record_result(r.user_id, t.mode, d > 0, greatest(d, 0));
      end if;
    end loop;
  end if;
  return true;
end $$;
revoke all on function public.okey_commit(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.okey_commit(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.okey_transfer_host(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nh uuid;
begin
  select user_id into nh from public.okey_players
   where table_id = p_table and user_id is not null and not is_bot and left_at is null
   order by joined_at limit 1;
  if nh is null then
    update public.okey_tables set status = 'closed' where id = p_table and status in ('waiting','finished');
  else
    update public.okey_tables set host_id = nh where id = p_table;
  end if;
end $$;
revoke all on function public.okey_transfer_host(uuid) from public, anon, authenticated;

create or replace function public.okey_join_table(p_table uuid, p_password text default null)
returns int language plpgsql security definer set search_path = public as $$
declare t public.okey_tables; seat_free int; cnt int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into t from public.okey_tables where id = p_table for update;
  if t.id is null then raise exception 'not_found'; end if;

  select seat into seat_free from public.okey_players
   where table_id = p_table and user_id = auth.uid() and left_at is null;
  if seat_free is not null then return seat_free; end if;

  -- reconnect: take back the seat a bot is holding for me
  update public.okey_players set user_id = auth.uid(), is_bot = false, connected = true, bot_for = null
   where id = (select id from public.okey_players where table_id = p_table and bot_for = auth.uid() and left_at is null limit 1)
  returning seat into seat_free;
  if seat_free is not null then return seat_free; end if;

  if t.status not in ('waiting','finished') then raise exception 'game_started'; end if;
  if t.password_hash is not null then
    if p_password is null or encode(digest(p_password,'sha256'),'hex') <> t.password_hash then
      raise exception 'bad_password';
    end if;
  end if;
  delete from public.okey_players where table_id = p_table and left_at is not null;
  delete from public.okey_viewers where table_id = p_table and user_id = auth.uid();

  select seat into seat_free from generate_series(0,3) seat
   where not exists (select 1 from public.okey_players p where p.table_id = p_table and p.seat = seat)
   order by seat limit 1;
  if seat_free is not null then
    insert into public.okey_players (table_id, user_id, seat, team)
    values (p_table, auth.uid(), seat_free, case when t.mode = 'pairs' then seat_free % 2 end);
  else
    -- between rounds a bot seat can be handed to a waiting human
    update public.okey_players set user_id = auth.uid(), is_bot = false, connected = true
     where id = (select id from public.okey_players where table_id = p_table and is_bot and bot_for is null order by seat limit 1)
    returning seat into seat_free;
    if seat_free is null then raise exception 'table_full'; end if;
  end if;
  insert into public.okey_stats (user_id) values (auth.uid()) on conflict do nothing;
  return seat_free;
end $$;

create or replace function public.okey_leave_table(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.okey_tables;
begin
  select * into t from public.okey_tables where id = p_table for update;
  if t.id is null then return; end if;
  if t.status = 'playing' then
    -- a bot keeps the seat warm; the player can reclaim it via okey_join_table
    update public.okey_players set is_bot = true, connected = false, bot_for = user_id, user_id = null
     where table_id = p_table and user_id = auth.uid() and left_at is null;
  else
    delete from public.okey_players where table_id = p_table and user_id = auth.uid();
  end if;
  delete from public.okey_viewers where table_id = p_table and user_id = auth.uid();
  if t.host_id = auth.uid() then perform public.okey_transfer_host(p_table); end if;
end $$;

create or replace function public.okey_state(p_table uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.okey_tables; my_seat int; hand jsonb := null;
begin
  if auth.uid() is null or not public.okey_is_member(p_table) then raise exception 'forbidden'; end if;
  select * into t from public.okey_tables where id = p_table;
  my_seat := public.okey_my_seat(p_table);
  if my_seat is not null then
    select tiles into hand from public.okey_hands where table_id = p_table and seat = my_seat;
  end if;
  return jsonb_build_object(
    'table', jsonb_build_object('id', t.id, 'name', t.name, 'mode', t.mode, 'status', t.status,
      'turn_seconds', t.turn_seconds, 'allow_viewers', t.allow_viewers, 'max_viewers', t.max_viewers,
      'livekit_room', t.livekit_room, 'host_id', t.host_id, 'has_password', t.password_hash is not null),
    'state', t.state - 'stock',
    'players', (select coalesce(jsonb_agg(jsonb_build_object('seat', p.seat, 'user_id', p.user_id, 'is_bot', p.is_bot,
        'bot_for', p.bot_for, 'team', p.team, 'score', p.score, 'connected', p.connected, 'hand_count',
        (select jsonb_array_length(h.tiles) from public.okey_hands h where h.table_id = p.table_id and h.seat = p.seat))
        order by p.seat), '[]'::jsonb)
      from public.okey_players p where p.table_id = p_table and p.left_at is null),
    'viewer_count', (select count(*) from public.okey_viewers v where v.table_id = p_table),
    'my_seat', my_seat,
    'my_hand', hand,
    'is_viewer', my_seat is null,
    'server_now', now()
  );
end $$;

-- Lobby helpers: okey_tables RLS hides non-member tables, so lookups go through these.
create or replace function public.okey_find_table(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'room', t.livekit_room, 'status', t.status, 'name', t.name,
    'has_password', t.password_hash is not null, 'allow_viewers', t.allow_viewers)
    from public.okey_tables t
   where (t.id::text = trim(p_code) or t.livekit_room = trim(p_code)) and t.status <> 'closed'
   limit 1;
$$;

create or replace function public.okey_quick_join()
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; s int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  for t in
    select id, livekit_room from public.okey_tables
     where status = 'waiting' and password_hash is null and created_at > now() - interval '3 hours'
     order by created_at desc limit 20
  loop
    begin
      s := public.okey_join_table(t.id, null);
      return jsonb_build_object('id', t.id, 'room', t.livekit_room, 'seat', s);
    exception when others then
      continue;
    end;
  end loop;
  return null;
end $$;

grant execute on function public.okey_start(uuid, boolean) to authenticated;
grant execute on function public.okey_find_table(text) to authenticated;
grant execute on function public.okey_quick_join() to authenticated;
