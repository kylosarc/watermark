import { describe, expect, it } from 'vitest';
import { dedupeBatchItems, withoutCachedCopies, type BatchIdentity } from '../batchItems';

function row(overrides: Partial<BatchIdentity> & { id: number }): BatchIdentity {
  return {
    fileName: 'capture.jpg',
    fileSize: 1024,
    ...overrides,
  };
}

describe('withoutCachedCopies', () => {
  it('drops only cached rows for a path being re-uploaded', () => {
    const existing = [
      row({ id: 1, restored: true }),
      row({ id: 2, fileName: 'other.jpg', restored: true }),
      row({ id: 3 }),
    ];
    const incoming = [row({ id: 4 })];

    expect(withoutCachedCopies(existing, incoming).map((item) => item.id)).toEqual([2, 3]);
  });

  it('treats a same-name file with a different size as a different path', () => {
    const existing = [row({ id: 1, fileSize: 1024, restored: true })];
    const incoming = [row({ id: 2, fileSize: 2048 })];

    expect(withoutCachedCopies(existing, incoming)).toHaveLength(1);
  });
});

describe('dedupeBatchItems', () => {
  it('prefers a fresh row over a cached row with the same hash', () => {
    const items = [
      row({ id: 1, fileName: 'cached.jpg', sha256: 'abc', restored: true }),
      row({ id: 2, fileName: 'fresh.jpg', sha256: 'abc' }),
    ];

    expect(dedupeBatchItems(items).map((item) => item.id)).toEqual([2]);
  });

  it('drops a cached row when a fresh row has the same path, even without a hash', () => {
    const items = [
      row({ id: 1, sha256: 'abc', restored: true }),
      row({ id: 2, sha256: '' }),
    ];

    expect(dedupeBatchItems(items).map((item) => item.id)).toEqual([2]);
  });

  it('collapses fresh duplicate content but keeps unrelated rows', () => {
    const items = [
      row({ id: 1, sha256: 'abc' }),
      row({ id: 2, fileName: 'copy.jpg', sha256: 'abc' }),
      row({ id: 3, fileName: 'other.jpg', sha256: 'def' }),
    ];

    expect(dedupeBatchItems(items).map((item) => item.id)).toEqual([1, 3]);
  });

  it('keeps distinct cached files and collapses cached duplicate content', () => {
    const items = [
      row({ id: 1, fileName: 'a.jpg', sha256: 'abc', restored: true }),
      row({ id: 2, fileName: 'b.jpg', sha256: 'abc', restored: true }),
      row({ id: 3, fileName: 'c.jpg', sha256: 'def', restored: true }),
    ];

    expect(dedupeBatchItems(items).map((item) => item.id)).toEqual([1, 3]);
  });

  it('preserves the original row order', () => {
    const items = [
      row({ id: 1, fileName: 'cached.jpg', sha256: 'old', restored: true }),
      row({ id: 2, fileName: 'fresh.jpg', sha256: 'new' }),
      row({ id: 3, fileName: 'cached-two.jpg', sha256: 'old-two', restored: true }),
    ];

    expect(dedupeBatchItems(items).map((item) => item.id)).toEqual([1, 2, 3]);
  });
});
