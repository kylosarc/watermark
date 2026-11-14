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

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function getSubtle(): SubtleCrypto | null {
  try {
    return typeof crypto !== 'undefined' &&
      crypto.subtle &&
      typeof crypto.subtle.digest === 'function'
      ? crypto.subtle
      : null;
  } catch {
    return null;
  }
}

/**
 * Pure-JS SHA-256.
 *
 * Web Crypto only exists in secure contexts (HTTPS, localhost). Watermark is
 * also served over plain HTTP on a LAN/Tailscale address, where
 * `crypto.subtle` is undefined. This fallback keeps hashes real instead of
 * silently substituting a timestamp.
 */
export function sha256Fallback(data: Uint8Array): string {
  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  const bitLen = data.length * 8;
  const total = Math.ceil((data.length + 9) / 64) * 64;
  const message = new Uint8Array(total);
  message.set(data);
  message[data.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 4, bitLen >>> 0, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i], false);
  return bytesToHex(out);
}

/** Pure-JS SHA-1, used only when Web Crypto is unavailable. */
export function sha1Fallback(data: Uint8Array): string {
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  const bitLen = data.length * 8;
  const total = Math.ceil((data.length + 9) / 64) * 64;
  const message = new Uint8Array(total);
  message.set(data);
  message[data.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 4, bitLen >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return bytesToHex(out);
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const subtle = getSubtle();
  if (subtle) return toHex(await subtle.digest('SHA-256', bytes));
  return sha256Fallback(bytes);
}

export async function sha1Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const subtle = getSubtle();
  if (subtle) return toHex(await subtle.digest('SHA-1', bytes));
  return sha1Fallback(bytes);
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
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
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
      bb = (bb + rotl(f, S[(j % 4) + 4 * Math.floor(j / 16)])) | 0;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
  }

  // MD5 digests are serialized little-endian per 32-bit word.
  const hex32 = (v: number) => {
    const word = v >>> 0;
    return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };
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
