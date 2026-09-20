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
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : value >= 1 ? 1 : 2)} ${units[exponent]}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(blob: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
}

export async function sha1Hex(blob: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-1', await blob.arrayBuffer()));
}

/** Lightweight MD5 — for fingerprinting only, not cryptographic use */
export async function md5Hex(blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const n = data.length;
  const bitLen = n * 8;

  // Pad: append 1-bit, zeros, then 64-bit LE length
  const padLen = (n % 64 < 56 ? 56 - (n % 64) : 120 - (n % 64));
  const msg = new Uint8Array(n + padLen + 8);
  msg.set(data);
  msg[n] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(n + padLen, bitLen >>> 0, true);
  dv.setUint32(n + padLen + 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d7,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
  ];
  const S = [
    7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21,
  ];

  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let i = 0; i < msg.length; i += 64) {
    const M = new Array<number>(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(i + j * 4, true);

    let [aa, bb, cc, dd] = [a, b, c, d];

    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) {
        f = (bb & cc) | (~bb & dd);
        g = j;
      } else if (j < 32) {
        f = (bb & dd) | (cc & ~dd);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * j + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * j) % 16;
      }
      f = (f + aa + K[j] + M[g]) | 0;
      aa = dd;
      dd = cc;
      cc = bb;
      bb = (bb + rotl(f, S[(j % 4) * 4 + Math.floor(j / 16)])) | 0;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
  }

  const hex32 = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
  return hex32(a) + hex32(b) + hex32(c) + hex32(d);
}

export interface HashResult {
  algorithm: string;
  hash: string;
}

export async function computeHashes(blob: Blob): Promise<HashResult[]> {
  const [sha256, sha1, md5] = await Promise.all([
    sha256Hex(blob),
    sha1Hex(blob),
    md5Hex(blob),
  ]);
  return [
    { algorithm: 'SHA-256', hash: sha256 },
    { algorithm: 'SHA-1', hash: sha1 },
    { algorithm: 'MD5', hash: md5 },
  ];
}
