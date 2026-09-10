const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
};

export function getMediaFormat(fileName: string, mimeType: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') {
    return mimeType;
  }

  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const mapped = MIME_BY_EXTENSION[extension];
  return mapped || mimeType || 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : value >= 1 ? 1 : 2)} ${units[exponent]}`;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
