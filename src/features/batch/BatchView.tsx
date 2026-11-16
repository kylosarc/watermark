import { useState, useEffect, useRef } from 'react';
import {
  Download,
  FolderOpen,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { verifyFile } from '../../lib/c2pa';
import { errorResult } from '../../lib/verification';
import { computeCrossFilePatterns, patternsExport, type PatternCount } from '../../lib/batchPatterns';
import { dedupeBatchItems, withoutCachedCopies } from '../../lib/batchItems';
import { formatBytes } from '../../lib/file';
import type { VerificationResult, VerificationStatus, ValidationState } from '../../lib/types';
import { storeMediaBatch, getStoredMediaBatch } from '../../lib/persist';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*';

function shortHash(value: string): string {
  return value.length > 20 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

/* ── Batch Report View ────────────────────────────────────────── */

export interface BatchItem {
  id: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  result: VerificationResult | null;
  status: 'pending' | 'verifying' | 'done' | 'error';
  restored?: boolean; // true if restored from localStorage (file not available)
}

let batchIdCounter = 0;

function PatternChips({ counts, empty }: { counts: PatternCount[]; empty: string }) {
  if (counts.length === 0) {
    return <span className="batch-pattern-note">{empty}</span>;
  }

  return (
    <div className="batch-pattern-values">
      {counts.slice(0, 8).map((count) => (
        <span
          key={count.value}
          className="batch-pattern-chip"
          title={`${count.value} — ${count.files} file${count.files === 1 ? '' : 's'}`}
        >
          {count.value} <strong>×{count.files}</strong>
        </span>
      ))}
      {counts.length > 8 && (
        <span className="batch-pattern-chip muted">+{counts.length - 8} more</span>
      )}
    </div>
  );
}

export function BatchView({ showToast }: { showToast: (msg: string) => void }) {
  const [items, setItems] = useState<BatchItem[]>(() => {
    const stored = getStoredMediaBatch();
    if (stored.length === 0) return [];
    // Update batchIdCounter to avoid collisions
    const maxId = Math.max(...stored.map((s) => s.id), 0);
    batchIdCounter = maxId;
    return stored.map((s) => ({
      id: s.id,
      fileName: s.fileName,
      fileSize: s.fileSize,
      mimeType: s.mimeType,
      result: s.sha256 ? {
        status: (s.status === 'done' ? 'ready' : s.status) as VerificationStatus,
        fileName: s.fileName,
        fileSize: s.fileSize,
        mimeType: s.mimeType,
        sha256: s.sha256,
        validationState: (s.validationState || 'Unknown') as ValidationState,
        manifestCount: s.manifestCount,
        manifests: [],
        signedAt: s.signedAt,
        warnings: [],
      } : null,
      status: s.status as 'pending' | 'verifying' | 'done' | 'error',
      restored: true,
    }));
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persistence: save media batch items, including an explicit empty state.
  useEffect(() => {
    storeMediaBatch(items.map((it) => ({
      id: it.id,
      fileName: it.fileName,
      fileSize: it.fileSize,
      mimeType: it.mimeType,
      sha256: it.result?.sha256 ?? '',
      status: it.status,
      validationState: it.result?.validationState ?? null,
      manifestCount: it.result?.manifestCount ?? 0,
      signedAt: it.result?.manifests?.find((m) => m.isActive)?.signedAt
        ?? it.result?.manifests?.[0]?.signedAt
        ?? null,
    })));
  }, [items]);

  async function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsProcessing(true);
    const newItems: BatchItem[] = fileArray.map((f) => ({
      id: ++batchIdCounter,
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.type || 'application/octet-stream',
      result: null,
      status: 'verifying' as const,
    }));

    // Re-uploading a path replaces its cached row rather than adding beside it.
    setItems((prev) => [...withoutCachedCopies(prev, newItems), ...newItems]);

    // Process in parallel batches of 4
    const BATCH_SIZE = 4;
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
      const batch = fileArray.slice(i, i + BATCH_SIZE);
      const batchItems = newItems.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((file) => verifyFile(file))
      );

      setItems((prev) => dedupeBatchItems(
        prev.map((item) => {
          const idx = batchItems.findIndex((b) => b.id === item.id);
          if (idx === -1) return { ...item, sha256: item.result?.sha256 };
          const result = results[idx];
          const nextResult = result.status === 'fulfilled'
            ? result.value
            : errorResult(item.fileName, item.fileSize, item.mimeType, '', result.reason);
          return {
            ...item,
            result: nextResult,
            sha256: nextResult.sha256,
            status: 'done' as const,
          };
        })
      ));
    }

    setIsProcessing(false);
    showToast(`Processed ${fileArray.length} files`);
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    void processFiles(e.target.files ?? []);
    e.target.value = '';
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    void processFiles(e.target.files ?? []);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    void processFiles(e.dataTransfer.files);
  }

  function clearResults() {
    setItems([]);
    storeMediaBatch([]);
    showToast('Batch results cleared');
  }

  function exportCSV() {
    if (items.length === 0) return;
    const headers = ['File Name', 'File Size', 'MIME Type', 'Has C2PA', 'Validation State', 'Manifest Count', 'Issuer', 'Claim Generator', 'Signature Algorithm', 'SHA-256'];
    const rows = items.map((item) => {
      const r = item.result;
      const active = r?.manifests.find((m) => m.isActive) ?? r?.manifests[0];
      return [
        item.fileName,
        String(item.fileSize),
        item.mimeType,
        r ? (r.status === 'ready' ? 'Yes' : 'No') : 'Pending',
        r?.validationState ?? 'Pending',
        String(r?.manifestCount ?? 0),
        active?.issuer ?? '',
        active?.claimGenerator ?? '',
        active?.signatureAlgorithm ?? '',
        r?.sha256 ?? '',
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadFile(csv, 'batch-report.csv', 'text/csv');
    showToast('CSV exported');
  }

  function exportJSON() {
    if (items.length === 0) return;
    const data = items.map((item) => {
      const r = item.result;
      const active = r?.manifests.find((m) => m.isActive) ?? r?.manifests[0];
      return {
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        hasC2PA: r ? r.status === 'ready' : null,
        validationState: r?.validationState ?? null,
        manifestCount: r?.manifestCount ?? 0,
        issuer: active?.issuer ?? null,
        claimGenerator: active?.claimGenerator ?? null,
        signatureAlgorithm: active?.signatureAlgorithm ?? null,
        signedAt: active?.signedAt ?? null,
        sha256: r?.sha256 ?? null,
        validationCodes: r?.manifests.flatMap((m) => m.validationCodes) ?? [],
      };
    });
    downloadFile(JSON.stringify(data, null, 2), 'batch-report.json', 'application/json');
    showToast('JSON exported');
  }

  function exportEvidencePack() {
    if (items.length === 0) return;
    const pack = items.map((item) => {
      const r = item.result;
      const active = r?.manifests.find((m) => m.isActive) ?? r?.manifests[0];
      return {
        _schema: 'watermark-evidence-pack/1.0',
        file: {
          name: item.fileName,
          size: item.fileSize,
          mimeType: item.mimeType,
          sha256: r?.sha256 ?? null,
        },
        verification: {
          status: r?.status ?? 'pending',
          validationState: r?.validationState ?? null,
          manifestCount: r?.manifestCount ?? 0,
        },
        manifest: active ? {
          issuer: active.issuer,
          claimGenerator: active.claimGenerator,
          signatureAlgorithm: active.signatureAlgorithm,
          signedAt: active.signedAt,
          assertionCount: active.assertions?.length ?? 0,
          validationCodes: active.validationCodes,
        } : null,
        allManifests: r?.manifests.map((m) => ({
          issuer: m.issuer,
          claimGenerator: m.claimGenerator,
          signedAt: m.signedAt,
          isActive: m.isActive,
          validationCodes: m.validationCodes,
        })) ?? [],
        exportedAt: new Date().toISOString(),
        tool: 'watermark',
      };
    });
    const json = JSON.stringify(pack.length === 1 ? pack[0] : pack, null, 2);
    downloadFile(json, `evidence-pack-${items.length > 1 ? 'batch' : (items[0]?.fileName ?? 'unknown')}.json`, 'application/json');
    showToast('Evidence pack exported');
  }

  function downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const doneCount = items.filter((i) => i.status === 'done').length;
  const trustedCount = items.filter((i) => i.result?.validationState === 'Trusted').length;
  const validCount = items.filter((i) => i.result?.validationState === 'Valid').length;
  const invalidCount = items.filter((i) => i.result?.validationState === 'Invalid').length;
  const missingCount = items.filter((i) => i.result?.status === 'missing').length;
  const verifiedResults = items.flatMap((item) => (item.result ? [item.result] : []));
  const patterns = computeCrossFilePatterns(verifiedResults);
  const signedLabel = patterns.signedRange.earliest && patterns.signedRange.latest
    ? (patterns.signedRange.earliest === patterns.signedRange.latest
      ? patterns.signedRange.earliest
      : `${patterns.signedRange.earliest} → ${patterns.signedRange.latest}`)
    : 'not reported';

  function exportPatterns() {
    if (verifiedResults.length === 0) return;
    downloadFile(patternsExport(patterns), 'batch-patterns.json', 'application/json');
    showToast('Cross-file patterns exported');
  }

  return (
    <main className="batch-view" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <div className="batch-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Batch Inspection Report</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Select a folder or multiple files to generate a provenance audit report. Export as CSV or JSON.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action-tactile button-primary" type="button" onClick={() => folderInputRef.current?.click()} disabled={isProcessing}>
            <FolderOpen size={15} /> Select Folder
          </button>
          <button className="action-tactile button-secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
            <Upload size={15} /> Select Files
          </button>
          {items.length > 0 && (
            <>
              <button className="action-tactile button-ghost" type="button" onClick={clearResults}>
                <Trash2 size={15} /> Clear
              </button>
              <button className="action-tactile button-secondary" type="button" onClick={exportCSV}>
                <Download size={15} /> CSV
              </button>
              <button className="action-tactile button-secondary" type="button" onClick={exportJSON}>
                <Download size={15} /> JSON
              </button>
              <button className="action-tactile button-secondary" type="button" onClick={exportEvidencePack}>
                <Download size={15} /> Evidence Pack
              </button>
            </>
          )}
          <input ref={folderInputRef} className="visually-hidden" type="file" {...{ webkitdirectory: '' }} multiple onChange={handleFolderSelect} />
          <input ref={fileInputRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES} multiple onChange={handleFileSelect} />
        </div>
      </div>

      {/* Summary Bar */}
      {items.length > 0 && (
        <div className="batch-summary">
          <div className="batch-summary-stat">
            <span className="batch-summary-label">Total</span>
            <strong>{items.length}</strong>
          </div>
          <div className="batch-summary-stat">
            <span className="batch-summary-label">Processed</span>
            <strong>{doneCount}</strong>
          </div>
          <div className="batch-summary-stat success">
            <span className="batch-summary-label">Trusted</span>
            <strong>{trustedCount}</strong>
          </div>
          <div className="batch-summary-stat info">
            <span className="batch-summary-label">Valid</span>
            <strong>{validCount}</strong>
          </div>
          <div className="batch-summary-stat warning">
            <span className="batch-summary-label">No C2PA</span>
            <strong>{missingCount}</strong>
          </div>
          <div className="batch-summary-stat danger">
            <span className="batch-summary-label">Invalid</span>
            <strong>{invalidCount}</strong>
          </div>
          {isProcessing && (
            <div className="batch-summary-stat">
              <RefreshCw size={14} className="spin" style={{ color: 'var(--color-primary)' }} />
              <span className="batch-summary-label">Processing...</span>
            </div>
          )}
        </div>
      )}

      {/* Cross-file Patterns */}
      {items.length > 1 && doneCount > 0 && (
        <section className="batch-patterns">
          <div className="batch-patterns-head">
            <div>
              <h2>Cross-file patterns</h2>
              <p>
                {patterns.totalFiles} verified file{patterns.totalFiles === 1 ? '' : 's'} compared.
                Every count comes from a manifest below; a claim is not a verdict.
              </p>
            </div>
            <button className="action-tactile button-ghost" type="button" style={{ fontSize: 11 }} onClick={exportPatterns}>
              <Download size={13} /> Patterns JSON
            </button>
          </div>

          <div className="batch-pattern-grid">
            <div className="batch-pattern-card">
              <span className="batch-pattern-label">Issuers</span>
              <PatternChips counts={patterns.issuers} empty="No issuer reported." />
            </div>
            <div className="batch-pattern-card">
              <span className="batch-pattern-label">Claim generators</span>
              <PatternChips counts={patterns.generators} empty="No claim generator reported." />
            </div>
            <div className="batch-pattern-card">
              <span className="batch-pattern-label">Signature algorithms</span>
              <PatternChips counts={patterns.algorithms} empty="No signature algorithm reported." />
            </div>
            <div className="batch-pattern-card">
              <span className="batch-pattern-label">Content signals</span>
              <div className="batch-pattern-values">
                <span className="batch-pattern-chip" title="Files declaring an AI-related DigitalSourceType">
                  AI source <strong>×{patterns.aiGenerated}</strong>
                </span>
                <span className="batch-pattern-chip" title="Files mentioning watermark or SynthID assertions">
                  Watermark claims <strong>×{patterns.watermarkClaims}</strong>
                </span>
                <span className="batch-pattern-chip" title="Files carrying soft binding assertions">
                  Soft bindings <strong>×{patterns.softBindings}</strong>
                </span>
              </div>
            </div>
            <div className="batch-pattern-card wide">
              <span className="batch-pattern-label">Shared assertions (2+ files)</span>
              <PatternChips counts={patterns.sharedAssertions} empty="No assertion label appears in 2+ files." />
            </div>
          </div>

          <p className="batch-pattern-note">
            <strong>Validation mix:</strong> {patterns.trusted} trusted · {patterns.valid} valid · {patterns.invalid} invalid · {patterns.unknown} unknown · {patterns.withoutC2PA} without C2PA
            <br />
            <strong>Signed:</strong> {signedLabel}
          </p>
          {patterns.notes.map((note) => (
            <p className="batch-pattern-note" key={note}>{note}</p>
          ))}
        </section>
      )}

      {/* Results Table */}
      {items.length > 0 && items.some(i => i.restored) && (
        <div style={{ padding: '8px 12px', background: 'rgba(76, 215, 246, 0.05)', borderRadius: 6, border: '1px solid rgba(76, 215, 246, 0.2)', fontSize: 12, color: 'var(--color-primary)' }}>
          Some entries are cached from a previous session. Drop the files again to re-verify them.
        </div>
      )}
      {items.length > 0 ? (
        <div className="batch-table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th>#</th>
                <th>File Name</th>
                <th>Size</th>
                <th>MIME</th>
                <th>Has C2PA</th>
                <th>Validation</th>
                <th>Issuer</th>
                <th>Claim Generator</th>
                <th>Algorithm</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const r = item.result;
                const active = r?.manifests.find((m) => m.isActive) ?? r?.manifests[0];
                return (
                  <tr key={item.id} className="stagger-row">
                    <td className="batch-cell-mono">{idx + 1}</td>
                    <td className="batch-cell-name" title={item.fileName}>
                      {item.fileName}
                      {item.restored && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-outline)', fontStyle: 'italic' }}>(cached)</span>}
                    </td>
                    <td className="batch-cell-mono">{formatBytes(item.fileSize)}</td>
                    <td className="batch-cell-mono">{item.mimeType}</td>
                    <td>
                      {item.status === 'verifying' ? (
                        <span className="batch-badge pending">Pending</span>
                      ) : r?.status === 'ready' ? (
                        <span className="batch-badge success">Yes</span>
                      ) : (
                        <span className="batch-badge muted">No</span>
                      )}
                    </td>
                    <td>
                      {r?.validationState === 'Trusted' ? (
                        <span className="batch-badge success" title="Cryptographically verified with trusted issuer">Trusted</span>
                      ) : r?.validationState === 'Valid' ? (
                        <span className="batch-badge info" title="Valid but issuer not in trust list">Valid</span>
                      ) : r?.validationState === 'Invalid' ? (
                        <span className="batch-badge danger" title="Signature or content binding failed">Invalid</span>
                      ) : (
                        <span className="batch-badge pending">—</span>
                      )}
                    </td>
                    <td className="batch-cell-mono" title={active?.issuer ?? ''}>{active?.issuer ?? '—'}</td>
                    <td className="batch-cell-mono" title={active?.claimGenerator ?? ''}>{active?.claimGenerator ?? '—'}</td>
                    <td className="batch-cell-mono">{active?.signatureAlgorithm ?? '—'}</td>
                    <td className="batch-cell-hash" title={r?.sha256 ?? ''}>{r ? shortHash(r.sha256) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="batch-empty">
          <FolderOpen size={48} style={{ color: 'var(--color-outline)' }} />
          <h3>No files selected</h3>
          <p>Drop files here, select a folder, or pick individual files to start batch inspection.</p>
        </div>
      )}
    </main>
  );
}
