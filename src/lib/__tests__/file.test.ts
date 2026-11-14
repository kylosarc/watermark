import { describe, expect, it } from 'vitest';
import {
  computeHashes,
  formatBytes,
  getMediaFormat,
  md5Hex,
  sha1Fallback,
  sha256Fallback,
  sha256Hex,
} from '../file';

describe('getMediaFormat', () => {
  it('uses the browser MIME type when available', () => {
    expect(getMediaFormat('asset.unknown', 'image/jpeg')).toBe('image/jpeg');
  });

  it('falls back to a supported image extension', () => {
    expect(getMediaFormat('asset.JPG', '')).toBe('image/jpeg');
  });

  it('keeps an octet-stream fallback for unknown files', () => {
    expect(getMediaFormat('asset.xyz', '')).toBe('application/octet-stream');
  });
});

describe('formatBytes', () => {
  it('formats zero and binary multiples', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});

describe('hash functions', () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);

  it('matches published vectors for abc', async () => {
    const hashes = await computeHashes(new Blob(['abc']));
    const byAlgorithm = Object.fromEntries(hashes.map((entry) => [entry.algorithm, entry.hash]));

    expect(byAlgorithm['SHA-256']).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(byAlgorithm['SHA-1']).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(byAlgorithm['MD5']).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('hashes binary PNG bytes identically to reference vectors', async () => {
    const expected =
      'a930c2bb4e61c0682068f71c4ef427eefbb07098ecea9390e445e7af4b66a384';
    const blob = new Blob([png], { type: 'image/png' });

    expect(await sha256Hex(blob)).toBe(expected);
    expect(sha256Fallback(png)).toBe(expected);
  });

  it('hashes UTF-8 text identically in the Web Crypto and JS paths', () => {
    const bytes = new TextEncoder().encode('héllo\nworld');
    expect(sha256Fallback(bytes)).toBe(
      'abae5185f1963d7a7ea5ca6f238c2e283163fb4fb48a91ff52be9055dcf18871',
    );
    expect(sha1Fallback(bytes)).toBe(
      '7ccf06c681887615ecd15cce0955f4e38e959938',
    );
  });

  it('handles empty input', () => {
    expect(sha256Fallback(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha1Fallback(new Uint8Array())).toBe(
      'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    );
    return expect(md5Hex(new Blob([]))).resolves.toBe(
      'd41d8cd98f00b204e9800998ecf8427e',
    );
  });
});