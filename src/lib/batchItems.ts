/**
 * Batch row identity rules.
 *
 * Cached rows are useful evidence from a previous session, but they must not
 * inflate a new run. A re-uploaded path replaces its cached row, and duplicate
 * content (same SHA-256) collapses to one row while preserving file order.
 */

export interface BatchIdentity {
  id: number;
  fileName: string;
  fileSize: number;
  sha256?: string;
  restored?: boolean;
}

function pathKey(item: BatchIdentity): string {
  return `${item.fileName}\u0000${item.fileSize}`;
}

/** Drop cached rows that the user is currently re-uploading. */
export function withoutCachedCopies<T extends BatchIdentity>(existing: T[], incoming: T[]): T[] {
  const incomingPaths = new Set(incoming.map(pathKey));
  return existing.filter((item) => !(item.restored && incomingPaths.has(pathKey(item))));
}

/**
 * Collapse duplicate content. Fresh rows win over cached rows; within each
 * group the first row wins. Rows without a hash are kept unless a fresh row
 * for the same path exists.
 */
export function dedupeBatchItems<T extends BatchIdentity>(items: T[]): T[] {
  const fresh = items.filter((item) => !item.restored);
  const freshHashes = new Set(fresh.flatMap((item) => (item.sha256 ? [item.sha256] : [])));
  const freshPaths = new Set(fresh.map(pathKey));
  const seenFreshHashes = new Set<string>();
  const seenRestoredHashes = new Set<string>();
  const keep = new Set<number>();

  for (const item of items) {
    if (!item.restored) {
      if (item.sha256) {
        if (seenFreshHashes.has(item.sha256)) continue;
        seenFreshHashes.add(item.sha256);
      }
      keep.add(item.id);
    }
  }

  for (const item of items) {
    if (!item.restored) continue;
    if (freshPaths.has(pathKey(item))) continue;
    if (item.sha256 && freshHashes.has(item.sha256)) continue;
    if (item.sha256 && seenRestoredHashes.has(item.sha256)) continue;
    if (item.sha256) seenRestoredHashes.add(item.sha256);
    keep.add(item.id);
  }

  return items.filter((item) => keep.has(item.id));
}
