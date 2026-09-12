/**
 * localStorage persistence for Watermark app state.
 * Persists: verification results, text items, batch items, stripper options.
 * File objects cannot be serialized — we store metadata + preview URLs instead.
 */

import type { VerificationResult } from './types';

// ── Keys ───────────────────────────────────────────────────────

const KEYS = {
  RESULT: 'wm:lastResult',
  RESULT_FILE: 'wm:lastResultFile',
  TEXT_ITEMS: 'wm:textItems',
  BATCH_ITEMS: 'wm:batchItems',
  STRIPPER_OPTS: 'wm:stripperOpts',
  LAST_VIEW: 'wm:lastView',
  SIM_RESULTS: 'wm:simResults',
  PLAYGROUND_RULES: 'wm:playgroundRules',
  DIFF_SLOT_A: 'wm:diffSlotA',
  MEDIA_BATCH: 'wm:mediaBatch',
} as const;

// ── Helpers ────────────────────────────────────────────────────

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage full — silently ignore
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

// ── Serializable file info (File objects can't be stored) ───────

export interface StoredFileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export function storeFileInfo(file: File | null): void {
  if (!file) {
    safeRemove(KEYS.RESULT_FILE);
    return;
  }
  safeSet(KEYS.RESULT_FILE, {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  });
}

export function getStoredFileInfo(): StoredFileInfo | null {
  return safeGet<StoredFileInfo | null>(KEYS.RESULT_FILE, null);
}

// ── Verification Result ────────────────────────────────────────

export function storeResult(result: VerificationResult | null): void {
  if (!result) {
    safeRemove(KEYS.RESULT);
    return;
  }
  safeSet(KEYS.RESULT, result);
}

export function getStoredResult(): VerificationResult | null {
  return safeGet<VerificationResult | null>(KEYS.RESULT, null);
}

// ── Text Items ─────────────────────────────────────────────────

interface StoredTextItem {
  id: number;
  content: string;
  source: 'file' | 'paste';
  fileName: string | null;
  sha256: string;
  format?: string;
  aiScore?: number;
  readabilityScore?: number;
}

export function storeTextItems(items: StoredTextItem[]): void {
  // Strip non-serializable fields (File objects, blobs)
  const serialized = items.map(item => ({
    id: item.id,
    content: item.content,
    source: item.source,
    fileName: item.fileName,
    sha256: item.sha256,
    format: item.format,
    aiScore: item.aiScore,
    readabilityScore: item.readabilityScore,
  }));
  safeSet(KEYS.TEXT_ITEMS, serialized);
}

export function getStoredTextItems(): StoredTextItem[] {
  return safeGet<StoredTextItem[]>(KEYS.TEXT_ITEMS, []);
}

// ── Batch Items ────────────────────────────────────────────────

export interface StoredBatchItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  status: string;
  validationState: string | null;
  manifestCount: number;
  signedAt: string | null;
}

export function storeBatchItems(items: StoredBatchItem[]): void {
  safeSet(KEYS.BATCH_ITEMS, items);
}

export function getStoredBatchItems(): StoredBatchItem[] {
  return safeGet<StoredBatchItem[]>(KEYS.BATCH_ITEMS, []);
}

// ── Stripper Options ───────────────────────────────────────────

export function storeStripperOpts(opts: Record<string, unknown>): void {
  safeSet(KEYS.STRIPPER_OPTS, opts);
}

export function getStoredStripperOpts(): Record<string, boolean> | null {
  return safeGet<Record<string, boolean> | null>(KEYS.STRIPPER_OPTS, null);
}

// ── Last View ──────────────────────────────────────────────────

export function storeLastView(view: string): void {
  safeSet(KEYS.LAST_VIEW, view);
}

export function getStoredLastView(): string | null {
  return safeGet<string | null>(KEYS.LAST_VIEW, null);
}

// ── Simulator Results ──────────────────────────────────────────

export interface StoredSimResult {
  name: string;
  description: string;
  hash: string;
  preserved: boolean;
}

export function storeSimResults(results: StoredSimResult[]): void {
  safeSet(KEYS.SIM_RESULTS, results);
}

export function getStoredSimResults(): StoredSimResult[] {
  return safeGet<StoredSimResult[]>(KEYS.SIM_RESULTS, []);
}

// ── Trust Playground Rules ─────────────────────────────────────

export interface StoredPlaygroundRule {
  id: string;
  field: string;
  operator: string;
  value: string;
  enabled: boolean;
}

export function storePlaygroundRules(rules: StoredPlaygroundRule[]): void {
  safeSet(KEYS.PLAYGROUND_RULES, rules);
}

export function getStoredPlaygroundRules(): StoredPlaygroundRule[] {
  return safeGet<StoredPlaygroundRule[]>(KEYS.PLAYGROUND_RULES, []);
}

// ── Diff Slot A ────────────────────────────────────────────────

export interface StoredDiffSlot {
  fileName: string | null;
  fileSize: number;
  mimeType: string;
  sha256: string;
  validationState: string;
}

export function storeDiffSlotA(slot: StoredDiffSlot | null): void {
  if (!slot) {
    safeRemove(KEYS.DIFF_SLOT_A);
    return;
  }
  safeSet(KEYS.DIFF_SLOT_A, slot);
}

export function getStoredDiffSlotA(): StoredDiffSlot | null {
  return safeGet<StoredDiffSlot | null>(KEYS.DIFF_SLOT_A, null);
}

// ── Media Batch ────────────────────────────────────────────────

export interface StoredMediaBatchItem {
  id: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  status: string;
  validationState: string | null;
  manifestCount: number;
  signedAt: string | null;
}

export function storeMediaBatch(items: StoredMediaBatchItem[]): void {
  safeSet(KEYS.MEDIA_BATCH, items);
}

export function getStoredMediaBatch(): StoredMediaBatchItem[] {
  return safeGet<StoredMediaBatchItem[]>(KEYS.MEDIA_BATCH, []);
}

// ── Clear All ──────────────────────────────────────────────────

export function clearAll(): void {
  Object.values(KEYS).forEach(safeRemove);
}
