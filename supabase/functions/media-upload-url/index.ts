// Issues short-lived presigned URLs for Cloudflare R2 (S3-compatible).
// Secrets required: R2_ACCOUNT_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//                   R2_BUCKET, optional R2_PUBLIC_BASE_URL
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPIRES_SECONDS = 300;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { path, contentType, action = 'upload' } = await req.json().catch(() => ({}));
  if (!path || typeof path !== 'string' || path.includes('..') || path.startsWith('/')) {
    return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const endpoint = Deno.env.get('R2_ACCOUNT_ENDPOINT');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return new Response(JSON.stringify({ error: 'r2 not configured' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const aws = new AwsClient({ accessKeyId, secretAccessKey, region: 'auto', service: 's3' });
  const method = action === 'download' ? 'GET' : 'PUT';

  const url = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${path}`);
  url.searchParams.set('X-Amz-Expires', String(EXPIRES_SECONDS));
  if (method === 'PUT' && contentType) url.searchParams.set('Content-Type', contentType);

  const signed = await aws.sign(url.toString(), { method, aws: { signQuery: true } });

  const publicBase = Deno.env.get('R2_PUBLIC_BASE_URL');
  return new Response(JSON.stringify({
    url: signed.url,
    publicUrl: publicBase ? `${publicBase.replace(/\/$/, '')}/${path}` : null,
    expiresIn: EXPIRES_SECONDS,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
