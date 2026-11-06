// Media job worker (edge-doable subset): probe + moderate.
// transcode/thumbnail/hls are claimed by an EXTERNAL worker (Cloudflare Worker/VPS with ffmpeg)
// using the same media_claim_jobs/media_finish_job RPCs — Edge Functions can't run ffmpeg.
// Invoke: POST {} with service-role or x-internal-token, or on a schedule.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function r2Head(key: string): Promise<{ size: number | null; type: string | null }> {
  const endpoint = Deno.env.get('R2_ACCOUNT_ENDPOINT');
  const aws = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    region: 'auto', service: 's3',
  });
  const bucket = Deno.env.get('R2_BUCKET')!;
  const url = new URL(`${endpoint!.replace(/\/$/, '')}/${bucket}/${key}`);
  url.searchParams.set('X-Amz-Expires', '60');
  const signed = await aws.sign(url.toString(), { method: 'HEAD', aws: { signQuery: true } });
  const res = await fetch(signed.url, { method: 'HEAD' });
  return {
    size: res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null,
    type: res.headers.get('content-type'),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const token = req.headers.get('x-internal-token') ?? '';
  const { data: cfg } = await admin.from('internal_config').select('value').eq('key', 'push_hook_token').single();
  const auth = req.headers.get('Authorization');
  const isService = auth === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!isService && (!cfg || cfg.value !== token)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: jobs, error } = await admin.rpc('media_claim_jobs', {
    p_limit: 10, p_worker: 'edge-media-process', p_types: ['probe', 'moderate', 'cleanup'],
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  if (!jobs?.length) return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const results: any[] = [];
  for (const job of jobs) {
    const t0 = Date.now();
    try {
      const { data: asset } = await admin.from('media_assets').select('*').eq('id', job.asset_id).single();
      if (!asset) { await admin.rpc('media_finish_job', { p_job: job.id, p_ok: false, p_error: 'asset missing' }); continue; }

      if (job.type === 'probe') {
        // verify object exists in R2 and size matches
        if (!asset.r2_key) throw new Error('no r2_key');
        const head = await r2Head(asset.r2_key);
        if (head.size == null) throw new Error('object not found in R2');
        if (asset.size_bytes && Math.abs(head.size - asset.size_bytes) > asset.size_bytes * 0.01) {
          throw new Error(`size mismatch: r2=${head.size} db=${asset.size_bytes}`);
        }
        await admin.from('media_assets').update({ status: 'processing' }).eq('id', asset.id);
      } else if (job.type === 'moderate') {
        // placeholder: real moderation API hook goes here (e.g. AWS Rekognition / Hive).
        // Auto-pass clean; flagged assets get moderation_status='flagged' via admin/report flow.
        await admin.from('media_assets').update({ moderation_status: 'clean' }).eq('id', asset.id);
      } else if (job.type === 'cleanup') {
        await admin.from('media_assets').update({ status: 'deleted' }).eq('id', asset.id);
      }
      await admin.rpc('media_finish_job', { p_job: job.id, p_ok: true, p_duration_ms: Date.now() - t0 });
      results.push({ job: job.id, type: job.type, ok: true });
    } catch (e: any) {
      await admin.rpc('media_finish_job', { p_job: job.id, p_ok: false, p_error: e?.message ?? 'error' });
      results.push({ job: job.id, type: job.type, ok: false, error: e?.message });
    }
  }
  return new Response(JSON.stringify({ processed: results.length, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
