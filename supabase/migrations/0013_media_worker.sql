-- Allow job-type filtering in claim (edge worker vs external transcoder)
create or replace function public.media_claim_jobs(p_limit int default 5, p_worker text default 'edge', p_types text[] default null)
returns setof public.media_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.media_jobs j
     set status='processing', locked_by=p_worker, locked_at=now(), attempts=attempts+1
   where j.id in (
     select id from public.media_jobs
      where status='pending' and run_after <= now()
        and (p_types is null or type = any(p_types))
      order by priority desc, created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end $$;

-- worker heartbeat stats (external transcoder reports here)
create or replace function public.media_job_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'pending', (select count(*) from public.media_jobs where status='pending'),
    'processing', (select count(*) from public.media_jobs where status='processing'),
    'failed_24h', (select count(*) from public.media_jobs where status='failed' and finished_at > now() - interval '24 hours'),
    'done_24h', (select count(*) from public.media_jobs where status='done' and finished_at > now() - interval '24 hours'),
    'avg_duration_ms', (select coalesce(avg(duration_ms),0)::int from public.media_jobs where status='done' and finished_at > now() - interval '24 hours')
  );
end $$;
