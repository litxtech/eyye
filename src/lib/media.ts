import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

// Compress/resize images before upload (chat, proofs, posts).
// Videos are passed through unchanged — transcode requires ffmpeg; keep under ~50MB.
export async function compressImage(uri: string, maxDim = 1600, quality = 0.7): Promise<{ uri: string; mime: string }> {
  try {
    const res = await manipulateAsync(uri, [{ resize: { width: maxDim } }], {
      compress: quality,
      format: SaveFormat.JPEG,
    });
    return { uri: res.uri, mime: 'image/jpeg' };
  } catch {
    return { uri, mime: 'image/jpeg' };
  }
}

export function isVideoAsset(asset: { type?: string | null; mimeType?: string | null; uri: string }): boolean {
  return asset.type === 'video' || !!asset.mimeType?.startsWith('video') || /\.(mp4|mov|m4v|webm|avi)(\?|$)/i.test(asset.uri);
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
