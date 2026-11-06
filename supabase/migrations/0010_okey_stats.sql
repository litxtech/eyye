-- Atomic okey stats recording
create or replace function public.okey_record_result(p_user uuid, p_mode text, p_won boolean, p_points int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.okey_stats (user_id) values (p_user) on conflict do nothing;
  update public.okey_stats set
    games = games + 1,
    wins = wins + case when p_won then 1 else 0 end,
    losses = losses + case when p_won then 0 else 1 end,
    solo_games = solo_games + case when p_mode='solo' then 1 else 0 end,
    solo_wins = solo_wins + case when p_mode='solo' and p_won then 1 else 0 end,
    pairs_games = pairs_games + case when p_mode='pairs' then 1 else 0 end,
    pairs_wins = pairs_wins + case when p_mode='pairs' and p_won then 1 else 0 end,
    total_points = total_points + greatest(0, p_points),
    xp = xp + greatest(0, p_points) + case when p_won then 50 else 10 end,
    level = greatest(level, floor((xp + greatest(0,p_points) + case when p_won then 50 else 10 end) / 500.0)::int + 1),
    updated_at = now()
  where user_id = p_user;
end $$;
revoke all on function public.okey_record_result(uuid, text, boolean, int) from public;
grant execute on function public.okey_record_result(uuid, text, boolean, int) to service_role;
