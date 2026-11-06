-- EYYE Ultra Fast Media Engine: assets, jobs queue, per-context limits

-- Per-context upload limits (bytes). Enforced server-side in edge functions.
create table if not exists public.media_limits (
  context text primary key,
  max_bytes bigint not null,
  max_duration_sec int,
  allowed_mime text[] not null default '{}',
  requires_processing boolean not null default false
);

insert into public.media_limits (context, max_bytes, max_duration_sec, allowed_mime, requires_processing) values
  ('post',        5368709120, 3600, '{"image/jpeg","image/png","image/webp","image/gif","image/avif","image/heic","video/mp4","video/quicktime"}', true),
  ('reel',        5368709120, 3600, '{"video/mp4","video/quicktime"}', true),
  ('message',     524288000,  300,  '{"image/jpeg","image/png","image/webp","image/gif","video/mp4","video/quicktime"}', false),
  ('group_chat',  524288000,  300,  '{"image/jpeg","image/png","image/webp","image/gif","video/mp4","video/quicktime"}', false),
  ('game_chat',   104857600,  60,   '{"image/jpeg","image/png","image/webp","image/gif","video/mp4"}', false),
  ('td_proof',    52428800,   30,   '{"image/jpeg","image/png","image/webp","video/mp4"}', false),
  ('profile',     20971520,   null, '{"image/jpeg","image/png","image/webp","image/heic"}', false),
  ('admin',       5368709120, 3600, '{"image/jpeg","image/png","image/webp","image/gif","video/mp4","video/quicktime","application/pdf"}', true)
on conflict (context) do nothing;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  context text not null,
  kind text not null default 'file' check (kind in ('image','video','audio','file')),
  status text not null default 'pending' check (status in (
    'pending','uploading','uploaded','processing','ready','failed','deleted')),
  mime text,
  size_bytes bigint,
  original_name text,
  r2_key text,
  width int, height int, duration_sec numeric,
  thumbnail_key text,
  variants jsonb not null default '{}'::jsonb,   -- {"360p": key, "480p": key, "720p": key, "hls": playlistKey}
  multipart jsonb,                                -- {uploadId, partSize, partCount, completedParts:[..]}
  sha256 text,
  attempts int not null default 0,
  last_error text,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','clean','flagged','blocked')),
  reported_count int not null default 0,
  parent_asset_id uuid references public.media_assets(id) on delete set null, -- e.g. thumbnail source
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz
);
create index if not exists media_assets_owner_idx on public.media_assets (owner_id, created_at desc);
create index if not exists media_assets_status_idx on public.media_assets (status) where status in ('processing','failed');
create index if not exists media_assets_context_idx on public.media_assets (context, created_at desc);

-- Processing queue (transcode, thumbnails, probe, moderation, hls)
create table if not exists public.media_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  type text not null check (type in ('probe','transcode','thumbnail','hls','moderate','cleanup')),
  status text not null default 'pending' check (status in ('pending','processing','done','failed','cancelled')),
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  payload jsonb not null default '{}'::jsonb,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  duration_ms int,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists media_jobs_pending_idx on public.media_jobs (status, run_after, priority desc) where status = 'pending';
create index if not exists media_jobs_asset_idx on public.media_jobs (asset_id);

-- Daily usage stats for admin dashboard
create table if not exists public.media_daily_stats (
  day date primary key,
  uploads int not null default 0,
  photos int not null default 0,
  videos int not null default 0,
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  transcode_ms bigint not null default 0,
  failed_jobs int not null default 0
);

alter table public.media_assets enable row level security;
alter table public.media_jobs enable row level security;
alter table public.media_limits enable row level security;
alter table public.media_daily_stats enable row level security;

-- limits readable by all authenticated (they're not secret)
create policy "media_limits_read" on public.media_limits for select to authenticated using (true);

-- assets: owner full access; others can read 'ready' assets (private contexts rely on signed URLs / app checks)
create policy "media_assets_owner" on public.media_assets for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "media_assets_read_ready" on public.media_assets for select to authenticated
  using (status = 'ready' and context in ('post','reel','profile','admin'));

-- jobs/daily stats: service role only
create policy "media_jobs_no_client" on public.media_jobs for all to authenticated using (false) with check (false);
create policy "media_stats_no_client" on public.media_daily_stats for all to authenticated using (false) with check (false);

-- RPC: create asset + enqueue initial jobs (called by client before upload)
create or replace function public.media_create_asset(
  p_context text, p_kind text, p_mime text, p_size_bytes bigint,
  p_original_name text default null, p_width int default null, p_height int default null,
  p_duration_sec numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lim public.media_limits%rowtype;
  aid uuid;
  maxres int := 1080;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into lim from public.media_limits where context = p_context;
  if not found then raise exception 'unknown_context'; end if;
  if p_size_bytes is null or p_size_bytes <= 0 then raise exception 'bad_size'; end if;
  if p_size_bytes > lim.max_bytes then raise exception 'file_too_large:%', lim.max_bytes; end if;
  if lim.max_duration_sec is not null and p_duration_sec is not null and p_duration_sec > lim.max_duration_sec then
    raise exception 'duration_too_long:%', lim.max_duration_sec;
  end if;
  if lim.allowed_mime is not null and array_length(lim.allowed_mime,1) > 0
     and not (p_mime = any(lim.allowed_mime)) then
    raise exception 'mime_not_allowed';
  end if;

  insert into public.media_assets (owner_id, context, kind, mime, size_bytes, original_name, width, height, duration_sec)
  values (auth.uid(), p_context, p_kind, p_mime, p_size_bytes, p_original_name, p_width, p_height, p_duration_sec)
  returning id into aid;

  -- enqueue processing jobs
  if p_kind = 'video' then
    insert into public.media_jobs (asset_id, type, priority) values
      (aid, 'probe', 10), (aid, 'transcode', 5), (aid, 'thumbnail', 5), (aid, 'hls', 1);
  elsif p_kind = 'image' then
    insert into public.media_jobs (asset_id, type, priority) values (aid, 'thumbnail', 5);
  end if;
  insert into public.media_jobs (asset_id, type, priority) values (aid, 'moderate', 8);

  return jsonb_build_object('asset_id', aid);
end $$;

-- RPC: mark upload complete -> status processing, schedule jobs
create or replace function public.media_upload_complete(p_asset uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.media_assets
    set status = case when kind = 'image' then 'ready' else 'processing' end,
        ready_at = case when kind = 'image' then now() else null end,
        updated_at = now()
    where id = p_asset and owner_id = auth.uid() and status in ('pending','uploading');
  if not found then raise exception 'not_found_or_wrong_state'; end if;
end $$;

-- RPC: client reports upload failure / cancel
create or replace function public.media_upload_fail(p_asset uuid, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.media_assets set status='failed', last_error=p_error, updated_at=now()
    where id = p_asset and owner_id = auth.uid();
  update public.media_jobs set status='cancelled', finished_at=now()
    where asset_id = p_asset and status='pending';
end $$;

-- claim next jobs (service role / edge function)
create or replace function public.media_claim_jobs(p_limit int default 5, p_worker text default 'edge')
returns setof public.media_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.media_jobs j
     set status='processing', locked_by=p_worker, locked_at=now(), attempts=attempts+1
   where j.id in (
     select id from public.media_jobs
      where status='pending' and run_after <= now()
      order by priority desc, created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end $$;

-- finish job
create or replace function public.media_finish_job(p_job uuid, p_ok boolean, p_error text default null, p_duration_ms int default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.media_jobs%rowtype;
begin
  select * into j from public.media_jobs where id = p_job;
  if not found then return; end if;
  if p_ok then
    update public.media_jobs set status='done', finished_at=now(), duration_ms=p_duration_ms, locked_by=null where id=p_job;
    -- if all jobs done -> asset ready
    update public.media_assets a
       set status='ready', ready_at=now(), updated_at=now()
     where a.id=j.asset_id and a.status='processing'
       and not exists (select 1 from public.media_jobs mj where mj.asset_id=a.id and mj.status in ('pending','processing'));
  elsif j.attempts < j.max_attempts then
    update public.media_jobs set status='pending', run_after=now() + (interval '30 seconds' * j.attempts),
      last_error=p_error, locked_by=null where id=p_job;
    update public.media_assets set status='processing', last_error=p_error, updated_at=now() where id=j.asset_id;
  else
    update public.media_jobs set status='failed', finished_at=now(), last_error=p_error, locked_by=null where id=p_job;
    update public.media_assets set status='failed', last_error=p_error, updated_at=now() where id=j.asset_id;
  end if;
end $$;

-- admin stats
create or replace function public.media_admin_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare today date := current_date;
begin
  if not public.is_moderator() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'today', (select to_jsonb(s) from public.media_daily_stats s where s.day=today),
    'pending_jobs', (select count(*) from public.media_jobs where status='pending'),
    'failed_jobs', (select count(*) from public.media_jobs where status='failed'),
    'processing_assets', (select count(*) from public.media_assets where status='processing'),
    'total_assets', (select count(*) from public.media_assets),
    'total_bytes', (select coalesce(sum(size_bytes),0) from public.media_assets where status<>'deleted')
  );
end $$;
