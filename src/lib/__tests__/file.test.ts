import { describe, expect, it } from 'vitest';
import { formatBytes, getMediaFormat } from '../file';

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
