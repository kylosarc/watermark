/**
 * Audit trail — timestamped log of all significant session actions.
 * Stored in localStorage, exportable as JSON.
 */

export interface AuditEntry {
  id: number;
  timestamp: string;
  action: string;
  detail: string;
  category: 'verify' | 'export' | 'edit' | 'sanitize' | 'nlp' | 'sim' | 'system';
}

let _entries: AuditEntry[] = [];
let _nextId = 1;

const STORAGE_KEY = 'wm:auditTrail';

/** Load persisted audit trail from localStorage */
export function loadAuditTrail(): AuditEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      _entries = JSON.parse(stored);
      _nextId = Math.max(..._entries.map(e => e.id), 0) + 1;
    }
  } catch { /* ignore */ }
  return [..._entries];
}

/** Persist audit trail to localStorage */
function persistAuditTrail(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_entries));
  } catch { /* ignore quota */ }
}

/** Record an audit event */
export function auditLog(action: string, detail: string, category: AuditEntry['category'] = 'system'): AuditEntry {
  const entry: AuditEntry = {
    id: _nextId++,
    timestamp: new Date().toISOString(),
    action,
    detail,
    category,
  };
  _entries.push(entry);
  persistAuditTrail();
  return entry;
}

/** Get all entries */
export function getAuditEntries(): AuditEntry[] {
  return [..._entries];
}

/** Clear audit trail */
export function clearAuditTrail(): void {
  _entries = [];
  persistAuditTrail();
}

/** Export as JSON string */
export function exportAuditTrail(): string {
  return JSON.stringify(_entries, null, 2);
}
