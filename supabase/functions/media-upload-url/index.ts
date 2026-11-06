// R2 upload URL issuer — single PUT + S3 multipart (init/part/complete/abort).
// Secrets: R2_ACCOUNT_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL?
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const EXPIRES_SECONDS = 3600; // multipart part URLs need longer life
const PART_SIZE = 16 * 1024 * 1024; // 16 MB chunks

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(o: any, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function r2Config() {
  const endpoint = Deno.env.get('R2_ACCOUNT_ENDPOINT');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), bucket, aws: new AwsClient({ accessKeyId, secretAccessKey, region: 'auto', service: 's3' }) };
}

async function presign(cfg: any, method: string, key: string, query: Record<string, string> = {}, expires = EXPIRES_SECONDS) {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set('X-Amz-Expires', String(expires));
  const signed = await cfg.aws.sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

// call R2/S3 API directly with signed request (for multipart create/complete/abort)
async function s3Call(cfg: any, method: string, key: string, query: Record<string, string>, body?: string) {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const signed = await cfg.aws.sign(url.toString(), { method, body: body ?? '', aws: { signQuery: false } });
  const res = await fetch(signed.url, { method, body: body ?? undefined, headers: signed.headers });
  const text = await res.text();
  return { ok: res.ok, status: res.status, xml: text };
}

function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const svc = admin;
  const { data: { user } } = await svc.auth.getUser(auth.slice(7));
  if (!user) return json({ error: 'unauthorized' }, 401);
  const cfg = await r2Config();
  if (!cfg) return json({ error: 'r2 not configured' }, 503);

  const body = await req.json().catch(() => ({}));
  const { action = 'upload', path, contentType, asset_id, uploadId, partNumber, parts } = body;

  const validPath = typeof path === 'string' && path.length > 0 && !path.includes('..') && !path.startsWith('/');
  if (!validPath) return json({ error: 'invalid path' }, 400);

  // ---- legacy single-shot upload URL ----
  if (action === 'download') {
    // view-once truth/dare evidence: only the uploader, or a recipient who
    // consumed their view in the last 5 minutes, may get a URL
    const { data: ev } = await svc.from('td_evidence').select('id, uploader_id').eq('storage_path', path).maybeSingle();
    if (ev && ev.uploader_id !== user.id) {
      const { data: rec } = await svc.from('td_evidence_recipients').select('consumed_at')
        .eq('evidence_id', ev.id).eq('user_id', user.id).maybeSingle();
      const fresh = rec?.consumed_at && Date.now() - new Date(rec.consumed_at).getTime() < 5 * 60 * 1000;
      if (!fresh) return json({ error: 'forbidden' }, 403);
    }
  }

  if (action === 'upload' || action === 'download') {
    const method = action === 'download' ? 'GET' : 'PUT';
    const expires = action === 'upload' ? EXPIRES_SECONDS : 300;
    const url = await presign(cfg, method, path, contentType && method === 'PUT' ? { 'Content-Type': contentType } : {}, expires);
    const publicBase = Deno.env.get('R2_PUBLIC_BASE_URL');
    return json({ url, publicUrl: publicBase ? `${publicBase.replace(/\/$/, '')}/${path}` : null, expiresIn: expires, partSize: PART_SIZE });
  }

  // ---- multipart actions require a media_assets row owned by caller ----
  const { data: { user } } = await admin.auth.getUser(auth.slice(7));
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!asset_id) return json({ error: 'asset_id required' }, 400);
  const { data: asset } = await admin.from('media_assets').select('id, owner_id, r2_key, multipart, status, size_bytes')
    .eq('id', asset_id).single();
  if (!asset || asset.owner_id !== user.id) return json({ error: 'forbidden' }, 403);

  const key = asset.r2_key ?? path;

  if (action === 'multipart-init') {
    const partCount = Math.max(1, Math.ceil((asset.size_bytes ?? 0) / PART_SIZE));
    const r = await s3Call(cfg, 'POST', key, { uploads: '' });
    const uploadId = xmlTag(r.xml, 'UploadId');
    if (!r.ok || !uploadId) return json({ error: 'r2 multipart init failed', detail: r.xml.slice(0, 300) }, 502);
    const mp = { uploadId, partSize: PART_SIZE, partCount, completedParts: [] };
    await admin.from('media_assets').update({ r2_key: key, multipart: mp, status: 'uploading' }).eq('id', asset_id);
    return json({ uploadId, partSize: PART_SIZE, partCount });
  }

  if (action === 'part-url') {
    const mp = asset.multipart;
    if (!mp?.uploadId) return json({ error: 'no multipart session' }, 400);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > mp.partCount) return json({ error: 'bad part number' }, 400);
    const url = await presign(cfg, 'PUT', key, { partNumber: String(partNumber), uploadId: mp.uploadId });
    return json({ url, partNumber, expiresIn: EXPIRES_SECONDS });
  }

  if (action === 'complete') {
    const mp = asset.multipart;
    if (!mp?.uploadId) return json({ error: 'no multipart session' }, 400);
    // build CompleteMultipartUpload XML
    const list = (parts ?? mp.completedParts ?? []).map((p: any) =>
      `<Part><PartNumber>${p.partNumber ?? p.PartNumber}</PartNumber><ETag>${p.etag ?? p.ETag}</ETag></Part>`).join('');
    const xml = `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${list}</CompleteMultipartUpload>`;
    const r = await s3Call(cfg, 'POST', key, { uploadId: mp.uploadId }, xml);
    if (!r.ok) return json({ error: 'complete failed', detail: r.xml.slice(0, 300) }, 502);
    await admin.from('media_assets').update({ multipart: { ...mp, completed: true }, status: 'uploaded' }).eq('id', asset_id);
    await admin.rpc('media_upload_complete', { p_asset: asset_id });
    return json({ ok: true });
  }

  if (action === 'abort') {
    const mp = asset.multipart;
    if (mp?.uploadId) await s3Call(cfg, 'DELETE', key, { uploadId: mp.uploadId });
    await admin.from('media_assets').update({ multipart: null }).eq('id', asset_id);
    await admin.rpc('media_upload_fail', { p_asset: asset_id, p_error: 'aborted' });
    return json({ ok: true });
  }

  return json({ error: 'unknown action' }, 400);
});
