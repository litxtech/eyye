// Sends queued push notifications via Expo Push API.
// Invoked by DB trigger (hook_push_delivery) with x-internal-token.
// Also callable manually to drain the queue: POST {"batch": true}

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  try {
    // auth: shared secret stored in internal_config (service-role only)
    const token = req.headers.get('x-internal-token') ?? '';
    const { data: cfg } = await admin
      .from('internal_config').select('value').eq('key', 'push_hook_token').single();
    if (!cfg || cfg.value !== token) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const jobId: string | null = body.job_id ?? null;

    // load jobs: single job or batch of pending
    let jobsQuery = admin
      .from('notification_delivery_jobs')
      .select('id, notification_id, user_id, status')
      .eq('channel', 'push')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(jobId ? 1 : 50);
    if (jobId) jobsQuery = jobsQuery.eq('id', jobId);
    const { data: jobs, error } = await jobsQuery;
    if (error) throw error;
    if (!jobs?.length) return json({ sent: 0 });

    const notifIds = [...new Set(jobs.map((j) => j.notification_id).filter(Boolean))] as string[];
    const userIds = [...new Set(jobs.map((j) => j.user_id))];

    const [{ data: notifs }, { data: devices }] = await Promise.all([
      admin.from('notifications').select('id, type, title, body, data').in('id', notifIds),
      admin.from('user_devices').select('user_id, push_token').in('user_id', userIds),
    ]);
    const notifById = new Map((notifs ?? []).map((n) => [n.id, n]));
    const tokensByUser = new Map<string, string[]>();
    for (const d of devices ?? []) {
      const arr = tokensByUser.get(d.user_id) ?? [];
      arr.push(d.push_token);
      tokensByUser.set(d.user_id, arr);
    }

    const messages: any[] = [];
    const messageJob: { jobId: string; tokens: string[] }[] = [];
    const badTokens = new Set<string>();

    for (const job of jobs) {
      const n = job.notification_id ? notifById.get(job.notification_id) : null;
      const tokens = tokensByUser.get(job.user_id) ?? [];
      if (!n || tokens.length === 0) {
        await markJob(job.id, tokens.length ? 'failed' : 'skipped', !n ? 'no notification' : 'no devices');
        continue;
      }
      const data = {
        ...(n.data ?? {}),
        type: n.type,
        notification_id: n.id,
      };
      for (const to of tokens) {
        messages.push({
          to,
          title: n.title,
          body: n.body ?? undefined,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          data,
        });
      }
      messageJob.push({ jobId: job.id, tokens });
    }

    if (!messages.length) return json({ sent: 0 });

    // Expo push accepts batches of up to 100
    const receipts: any[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      const jsonRes = await res.json();
      receipts.push(...(jsonRes.data ?? []));
    }

    // map receipts back: each message index corresponds to a (job, token) pair
    let idx = 0;
    let sent = 0;
    for (const mj of messageJob) {
      let ok = 0, fail = 0, lastErr = '';
      for (const _ of mj.tokens) {
        const r = receipts[idx++];
        if (r?.status === 'ok') { ok++; sent++; }
        else {
          fail++;
          lastErr = r?.message ?? r?.details?.error ?? 'push failed';
          if (r?.details?.error === 'DeviceNotRegistered' || /not.*registered/i.test(lastErr)) {
            // find token: receipts don't echo token; remove lazily below
          }
        }
      }
      await markJob(mj.jobId, fail === 0 ? 'sent' : ok > 0 ? 'sent' : 'failed',
        fail ? `${fail} failed: ${lastErr}` : null);
    }

    // prune DeviceNotRegistered tokens: refetch receipts with tickets is complex;
    // cheap approach — delete tokens Expo flags via a second pass is skipped here.
    return json({ sent, jobs: jobs.length });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'internal' }), { status: 500 });
  }
});

async function markJob(id: string, status: string, err: string | null) {
  await admin.from('notification_delivery_jobs').update({
    status,
    last_error: err,
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  }).eq('id', id);
}

function json(o: any) {
  return new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
}
