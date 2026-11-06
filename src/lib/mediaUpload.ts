import { supabase } from './supabase';

// EYYE media upload client: single PUT for small files, S3 multipart for large.
// All bytes go DIRECTLY to Cloudflare R2 via short-lived presigned URLs —
// nothing streams through Supabase. R2 keys never leave the server side.

export type UploadContext = 'post' | 'reel' | 'message' | 'group_chat' | 'game_chat' | 'td_proof' | 'profile' | 'admin';
export type UploadStatus = 'preparing' | 'uploading' | 'processing' | 'ready' | 'failed' | 'retrying';

export interface UploadCallbacks {
  onStatus?: (s: UploadStatus) => void;
  onProgress?: (pct: number) => void; // 0-100
}

export interface UploadResult {
  assetId: string;
  r2Key: string;
  publicUrl: string | null;
}

const MULTIPART_THRESHOLD = 8 * 1024 * 1024; // >8MB -> multipart
const MAX_RETRIES = 3;

function extOf(name: string, mime: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('video')) return mime.includes('quicktime') ? 'mov' : 'mp4';
  if (mime.includes('pdf')) return 'pdf';
  return 'jpg';
}

async function callFn(body: any) {
  const { data, error } = await supabase.functions.invoke('media-upload-url', { body });
  if (error) throw new Error(error.message ?? 'upload-url failed');
  return data;
}

async function putChunk(url: string, data: ArrayBuffer | Blob, contentType: string, retries = MAX_RETRIES): Promise<string> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: data as any, headers: { 'Content-Type': contentType } });
      if (!res.ok) throw new Error(`PUT ${res.status}`);
      return res.headers.get('etag') ?? '';
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

// Read a byte range of a local file as ArrayBuffer via blob slicing (no full-file memory load)
async function readRange(uri: string, start: number, end: number): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return blob.slice(start, end).arrayBuffer();
}

export async function uploadMedia(opts: {
  uri: string;
  fileName?: string;
  mime: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'file';
  context: UploadContext;
  width?: number;
  height?: number;
  durationSec?: number;
  signal?: { cancelled: boolean };
}, cb: UploadCallbacks = {}): Promise<UploadResult> {
  const setStatus = (s: UploadStatus) => cb.onStatus?.(s);
  setStatus('preparing');

  // 1) register asset server-side (validates context limits + mime)
  const { data: created, error: createErr } = await supabase.rpc('media_create_asset', {
    p_context: opts.context,
    p_kind: opts.kind,
    p_mime: opts.mime,
    p_size_bytes: opts.size,
    p_original_name: opts.fileName ?? null,
    p_width: opts.width ?? null,
    p_height: opts.height ?? null,
    p_duration_sec: opts.durationSec ?? null,
  });
  if (createErr) throw new Error(createErr.message);
  const assetId = (created as any).asset_id as string;

  const r2Key = `media/${opts.context}/${assetId}.${extOf(opts.fileName ?? '', opts.mime)}`;
  const fail = async (e: any): Promise<never> => {
    try {
      await supabase.rpc('media_upload_fail', { p_asset: assetId, p_error: String(e?.message ?? e) });
    } catch { /* ignore */ }
    setStatus('failed');
    throw e;
  };

  try {
    if (opts.size <= MULTIPART_THRESHOLD) {
      // ---- single PUT ----
      setStatus('uploading');
      const up = await callFn({ action: 'upload', path: r2Key, contentType: opts.mime, asset_id: assetId });
      const blob = await (await fetch(opts.uri)).blob();
      await putChunk(up.url, blob, opts.mime);
      cb.onProgress?.(100);
    } else {
      // ---- multipart ----
      setStatus('uploading');
      const init = await callFn({ action: 'multipart-init', path: r2Key, asset_id: assetId });
      const { uploadId, partSize, partCount } = init;
      const completed: { partNumber: number; etag: string }[] = [];
      let uploaded = 0;

      for (let p = 1; p <= partCount; p++) {
        if (opts.signal?.cancelled) {
          await callFn({ action: 'abort', path: r2Key, asset_id: assetId }).catch(() => {});
          setStatus('failed');
          throw new Error('cancelled');
        }
        const start = (p - 1) * partSize;
        const end = Math.min(p * partSize, opts.size);
        let etag = '';
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (attempt > 0) setStatus('retrying');
          const { data: pu } = await supabase.functions.invoke('media-upload-url', {
            body: { action: 'part-url', path: r2Key, asset_id: assetId, partNumber: p },
          });
          if (!pu?.url) throw new Error('part-url failed');
          const chunk = await readRange(opts.uri, start, end);
          etag = await putChunk(pu.url, chunk, opts.mime, 1);
          break;
        }
        completed.push({ partNumber: p, etag });
        uploaded += end - start;
        cb.onProgress?.(Math.round((uploaded / opts.size) * 100));
      }

      setStatus('processing');
      await callFn({ action: 'complete', path: r2Key, asset_id: assetId, parts: completed });
      cb.onProgress?.(100);
    }

    await supabase.rpc('media_upload_complete', { p_asset: assetId });
    setStatus(opts.kind === 'image' ? 'ready' : 'processing');
    return { assetId, r2Key, publicUrl: null };
  } catch (e) {
    return fail(e);
  }
}
