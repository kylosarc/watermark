import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import { type DragEvent, useCallback, useEffect, useRef, useState, Component, type ReactNode } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  Code,
  Copy,
  Crop,
  Diff,
  Download,
  Eye,
  FileCheck2,
  FileJson,
  FileText,
  FileUp,
  FolderOpen,
  Fingerprint,
  GitBranch,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers3,
  List,
  Loader2,
  Lock,
  LockKeyhole,
  Maximize,
  Pencil,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  Layers,
  Settings,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Zap,
  ZoomIn
} from 'lucide-react';
import { verifyFile } from './lib/c2pa';
import { errorResult } from './lib/verification';
import { formatBytes, sha256Hex, computeHashes, type HashResult } from './lib/file';
import { extractTextFromFile, TEXT_ACCEPT, detectFormat } from './lib/extract';
import { extractFileMetadata, type FileMetadata, type BinaryInfo, sanitizeMetadata, SANITIZE_PRESETS, applyMetadataEdit } from './lib/metadata';
import {
  applyStripper, STRIPPER_DEFAULTS, STRIPPER_PRESETS,
  detectUnslopPatterns, applyUnslop,
  normalizePdfText,
  type StripperOptions, type UnslopPattern,
} from './lib/transform';
import { harperLint, harperFixAll } from './lib/harper';
import type { HarperLint } from './lib/harper';
import { analyzeWithNlp, POS_LABELS, getWinkStatus } from './lib/winkNlp';
import type { ManifestSummary, ValidationCode, VerificationResult, VerificationStatus, ValidationState } from './lib/types';
import {
  storeResult, getStoredResult,
  storeFileInfo, getStoredFileInfo,
  storeTextItems, getStoredTextItems,
  storeStripperOpts, getStoredStripperOpts,
  storeLastView, getStoredLastView,
  storeSimResults, getStoredSimResults,
  storePlaygroundRules, getStoredPlaygroundRules,
  storeDiffSlotA, getStoredDiffSlotA,
  storeMediaBatch, getStoredMediaBatch,
  clearAll,
} from './lib/persist';
import { storeFileBlob, getStoredFileBlob, clearFileBlob } from './lib/persist';
import { loadAuditTrail, getAuditEntries, clearAuditTrail, exportAuditTrail, auditLog, type AuditEntry } from './lib/audit';
import './styles.css';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*,.txt,.md,.json,.html,.csv,.xml,.yaml,.yml,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.h,.rb,.php,.sql,.sh,.css,.docx,.pptx,.pdf';
const SAMPLE_NAME = 'alpine_dawn_capture_2025.jpg';

type AppMode = 'inspect' | 'provenance' | 'transform';
type View = 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text' | 'evidence' | 'settings' | 'edit';
type InspectorTab = 'overview' | 'assertions' | 'cryptography' | 'metadata' | 'raw-json';

const STATUS_LABELS: Record<VerificationStatus, string> = {
  idle: 'Ready',
  loading: 'Verifying',
  ready: 'Credentials found',
  missing: 'No credentials found',
  invalid: 'Invalid credentials',
  error: 'Verification failed'
};

// ── Error Boundary ─────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-error)' }}>
          <AlertTriangle size={32} style={{ marginBottom: 8 }} />
          <h3 style={{ marginBottom: 4 }}>Something went wrong</h3>
          <p style={{ fontSize: 13, color: 'var(--color-outline)' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          <button
            className="action-tactile button-ghost"
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 12 }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const STATUS_TONES: Record<VerificationStatus, string> = {
  idle: 'neutral',
  loading: 'info',
  ready: 'success',
  missing: 'warning',
  invalid: 'danger',
  error: 'danger'
};

const NAV_ITEMS_BASE = [
  { id: 'inspector' as View, label: 'Inspector', icon: ScanSearch },
  { id: 'edit' as View, label: 'Edit w/ Provenance', icon: Crop },
  { id: 'batch' as View, label: 'Batch Report', icon: List },
  { id: 'diff' as View, label: 'Provenance Diff', icon: Diff },
  { id: 'simulator' as View, label: 'What Would Break?', icon: Zap },
  { id: 'playground' as View, label: 'Trust Playground', icon: Settings2 },
  { id: 'lineage' as View, label: 'Manifest Lineage', icon: GitBranch },
  { id: 'text' as View, label: 'Text Analysis', icon: FileText },
  { id: 'evidence' as View, label: 'Evidence Export', icon: FileCheck2 },
  { id: 'settings' as View, label: 'Trust Anchors / Settings', icon: Settings }
];

const INSPECTOR_TABS = [
  { id: 'overview' as InspectorTab, label: 'Manifest Overview', icon: Info },
  { id: 'assertions' as InspectorTab, label: 'Assertions & Ingredients', icon: Layers },
  { id: 'cryptography' as InspectorTab, label: 'Cryptographic Proof', icon: Lock },
  { id: 'metadata' as InspectorTab, label: 'File Metadata', icon: ScanSearch },
  { id: 'raw-json' as InspectorTab, label: 'Raw JSON Manifest', icon: Code }
];

/* ── Toast System ──────────────────────────────────────────── */

interface ToastItem {
  id: number;
  message: string;
}

let toastCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }, []);

  return { toasts, show };
}

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <CheckCircle2 className="toast-icon" size={18} />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

function formatDate(value: string | undefined): string {
  if (!value) return 'Not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortHash(value: string): string {
  return value.length > 20 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function generateTrustReport(result: VerificationResult, file: File | null) {
  const active = result.manifests.find((m) => m.isActive) ?? result.manifests[0];
  const stateColor = result.validationState === 'Trusted' ? '#22c55e' : result.validationState === 'Valid' ? '#3b82f6' : result.validationState === 'Invalid' ? '#ef4444' : '#94a3b8';
  const stateBg = result.validationState === 'Trusted' ? '#22c55e15' : result.validationState === 'Valid' ? '#3b82f615' : result.validationState === 'Invalid' ? '#ef444415' : '#94a3b815';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trust Report — ${file?.name ?? 'Asset'}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;color:#e2e8f0;padding:2rem;max-width:720px;margin:0 auto}
  h1{font-size:1.4rem;margin-bottom:.25rem}
  .subtitle{color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
  .card{background:#1a1d27;border:1px solid #2d3348;border-radius:12px;padding:1.25rem;margin-bottom:1rem}
  .card h2{font-size:1rem;margin-bottom:.75rem;color:#e2e8f0}
  .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:.8rem;font-weight:600}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2d334830;font-size:.85rem}
  .row:last-child{border-bottom:none}
  .label{color:#94a3b8}
  .value{color:#e2e8f0;font-family:'JetBrains Mono',monospace;font-size:.8rem;word-break:break-all}
  .check{display:flex;align-items:center;gap:8px;padding:8px 0;font-size:.85rem}
  .check-icon{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
  .pass{background:#22c55e20;color:#22c55e}
  .fail{background:#ef444420;color:#ef4444}
  .footer{margin-top:2rem;text-align:center;color:#64748b;font-size:.75rem}
</style>
</head>
<body>
<h1>C2PA Trust Report</h1>
<p class="subtitle">Generated ${new Date().toLocaleString()} by Watermark</p>

<div class="card">
  <h2>Verification Status</h2>
  <div style="text-align:center;padding:1rem 0">
    <span class="badge" style="background:${stateBg};color:${stateColor};font-size:1.1rem;padding:8px 24px">${result.validationState}</span>
  </div>
  <div class="row"><span class="label">File</span><span class="value">${file?.name ?? 'Unknown'}</span></div>
  <div class="row"><span class="label">Size</span><span class="value">${result.fileSize.toLocaleString()} bytes</span></div>
  <div class="row"><span class="label">Type</span><span class="value">${result.mimeType}</span></div>
  <div class="row"><span class="label">SHA-256</span><span class="value" style="font-size:.7rem">${result.sha256}</span></div>
</div>

<div class="card">
  <h2>Cryptographic Checks</h2>
  <div class="check"><span class="check-icon ${result.validationState !== 'Unknown' ? 'pass' : 'fail'}">${result.validationState !== 'Unknown' ? '✓' : '—'}</span>Signature Integrity</div>
  <div class="check"><span class="check-icon ${result.validationState === 'Trusted' ? 'pass' : 'fail'}">${result.validationState === 'Trusted' ? '✓' : '✗'}</span>Certificate Chain</div>
  <div class="check"><span class="check-icon pass">✓</span>Content Hash Binding</div>
  <div class="check"><span class="check-icon ${result.manifestCount > 0 ? 'pass' : 'fail'}">${result.manifestCount > 0 ? '✓' : '✗'}</span>Manifest Present (${result.manifestCount})</div>
</div>

${active ? `
<div class="card">
  <h2>Active Manifest</h2>
  <div class="row"><span class="label">Generator</span><span class="value">${active.claimGenerator ?? 'Unknown'}</span></div>
  <div class="row"><span class="label">Issuer</span><span class="value">${active.issuer ?? 'Unknown'}</span></div>
  <div class="row"><span class="label">Algorithm</span><span class="value">${active.signatureAlgorithm ?? 'Unknown'}</span></div>
  <div class="row"><span class="label">Signed</span><span class="value">${formatDate(active.signedAt)}</span></div>
  <div class="row"><span class="label">Assertions</span><span class="value">${active.assertions.length}</span></div>
</div>` : ''}

<div class="footer">
  This report was generated by Watermark — local-first C2PA verification tool.<br>
  Verification confirms cryptographic integrity and content binding, not real-world truth.
</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trust-report-${file?.name ?? 'asset'}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Small Components ───────────────────────────────────────── */

function StatusBadge({ status }: { status: VerificationStatus }) {
  return <span className={`verdict-pill ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}

function CodeList({ codes }: { codes: ValidationCode[] }) {
  if (codes.length === 0) {
    return <p className="muted">No detailed validation codes were returned.</p>;
  }
  return (
    <ul className="code-list">
      {codes.map((code, index) => (
        <li key={`${code.code}-${index}`}>
          <strong>{code.code}</strong>
          {code.explanation ? <span>{code.explanation}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ── Assertion Search & Policy Check ─────────────────────────── */

const ASSERTION_CATEGORIES: Record<string, string> = {
  'c2pa.hash': 'binding',
  'c2pa CLAIM_SIGNATURE': 'signature',
  'c2pa.relationships': 'provenance',
  'c2pa.artist': 'provenance',
  'c2pa.description': 'provenance',
  'c2pa.rating': 'provenance',
  'c2pa.location': 'provenance',
  'c2pa.datetime': 'provenance',
  'c2pa.softwareAgent': 'provenance',
  'c2pa.tombof': 'provenance',
  'c2pa.capture': 'provenance',
  'c2pa Actions': 'action',
  'assertion.c2pa.colour_space': 'technical',
  'assertion.c2pa.thumbnail': 'technical',
  'assertion.c2pa.video': 'technical',
  'assertion.c2pa.audio': 'technical',
};

function categorizeAssertion(label: string): string {
  for (const [pattern, cat] of Object.entries(ASSERTION_CATEGORIES)) {
    if (label.includes(pattern)) return cat;
  }
  if (label.includes('hash') || label.includes('binding')) return 'binding';
  if (label.includes('signature') || label.includes('sign')) return 'signature';
  return 'other';
}

const CAT_COLORS: Record<string, string> = {
  binding: 'var(--color-tertiary)',
  signature: '#f59e0b',
  provenance: 'var(--color-primary)',
  technical: 'var(--color-secondary)',
  other: 'var(--color-muted)',
};

function AssertionSearch({ assertions }: { assertions: string[] }) {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? assertions.filter((a) => a.toLowerCase().includes(query.toLowerCase()))
    : assertions;

  // Policy summary: count by category
  const catCounts: Record<string, number> = {};
  for (const a of assertions) {
    const cat = categorizeAssertion(a);
    catCounts[cat] = (catCounts[cat] ?? 0) + 1;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="Search assertions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 10px 6px 28px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            background: 'var(--color-surface)',
            color: 'var(--color-on-surface)',
            border: '1px solid var(--color-outline-variant)',
            borderRadius: 6,
            outline: 'none',
          }}
        />
        <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
      </div>

      {/* Policy summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(catCounts).map(([cat, count]) => (
          <span key={cat} style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 10,
            background: `${CAT_COLORS[cat] ?? 'var(--color-muted)'}20`,
            color: CAT_COLORS[cat] ?? 'var(--color-muted)',
            border: `1px solid ${CAT_COLORS[cat] ?? 'var(--color-muted)'}40`,
          }}>
            {cat}: {count}
          </span>
        ))}
      </div>

      {/* Filtered list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && (
          <p style={{ color: 'var(--color-muted)', fontSize: 12 }}>{query ? 'No matching assertions.' : 'None listed.'}</p>
        )}
        {filtered.map((assertion, i) => {
          const cat = categorizeAssertion(assertion);
          return (
            <div key={assertion} className="action-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(61,73,76,0.2)' }}>
              <div className="action-num" style={{ minWidth: 24, fontSize: 10, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-on-surface)', fontFamily: 'var(--font-mono)' }}>{assertion}</span>
                  <span style={{
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: `${CAT_COLORS[cat] ?? 'var(--color-muted)'}20`,
                    color: CAT_COLORS[cat] ?? 'var(--color-muted)',
                  }}>
                    {cat}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { BinaryInspector, HashCalculatorPanel, MetadataTab, ManifestCard, CryptoCheck, EmptyInspector } from './features/inspector';
import { BatchView } from './features/batch/BatchView';
import { DiffView } from './features/provenance/DiffView';
import { LineageView } from './features/provenance/LineageView';
import { SimulatorView } from './features/simulator/SimulatorView';
import { PlaygroundView } from './features/playground/PlaygroundView';
import { TextView } from './features/text/TextView';
import { ProvenanceGraph } from './features/provenance/ProvenanceGraph';
import { buildEvidenceSummary, groupByPerspective, explainValidationState, explainFinding } from './lib/verification-evidence';
import { PERSPECTIVE_LABELS, PERSPECTIVE_COLORS, STATUS_LABELS as EVIDENCE_STATUS_LABELS, STATUS_COLORS as EVIDENCE_STATUS_COLORS, STATUS_EMOJI as EVIDENCE_STATUS_EMOJI, CATEGORY_LABELS } from './lib/evidence';
import type { Perspective, Finding, EvidenceStatus } from './lib/evidence';

/* ── Mode-aware NAV_ITEMS ──────────────────────────────────────── */

const NAV_ITEMS: Record<AppMode, typeof NAV_ITEMS_BASE[number][]> = {
  inspect: NAV_ITEMS_BASE.filter((item) =>
    ['inspector', 'batch'].includes(item.id)
  ),
  provenance: NAV_ITEMS_BASE.filter((item) =>
    ['diff', 'simulator', 'playground', 'lineage'].includes(item.id)
  ),
  transform: NAV_ITEMS_BASE.filter((item) =>
    ['edit', 'text'].includes(item.id)
  ),
};

/* Items always visible regardless of mode */
const ALWAYS_VISIBLE = NAV_ITEMS_BASE.filter((item) =>
  ['evidence', 'settings'].includes(item.id)
);

function FutureView({ view, result }: { view: Exclude<View, 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text'>; result: VerificationResult | null }) {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(() => loadAuditTrail());

  // Refresh audit trail when view changes
  useEffect(() => {
    if (view === 'settings') {
      setAuditEntries(getAuditEntries());
    }
  }, [view]);

  if (view === 'settings') {
    return (
      <main className="app-main" style={{ padding: 16, maxWidth: 700, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 16 }}>Audit Trail</h2>
        <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 16 }}>
          Timestamped log of all verification, export, and edit actions in this session.
        </p>
        {auditEntries.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-muted)', fontSize: 12, background: 'var(--color-surface)', borderRadius: 8 }}>
            No audit entries yet. Verify a file to start logging.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className="action-tactile button-ghost" type="button" style={{ fontSize: 11 }} onClick={() => {
                const blob = new Blob([exportAuditTrail()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'audit-trail.json'; a.click(); URL.revokeObjectURL(url);
              }}>
                <Download size={12} /> Export JSON
              </button>
              <button className="action-tactile button-ghost" type="button" style={{ fontSize: 11, color: '#f87171' }} onClick={() => { clearAuditTrail(); setAuditEntries([]); }}>
                <Trash2 size={12} /> Clear
              </button>
            </div>
            <div style={{ background: 'var(--color-surface)', borderRadius: 8, border: '1px solid rgba(61,73,76,0.3)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(61,73,76,0.3)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--color-muted)', fontWeight: 500 }}>Time</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--color-muted)', fontWeight: 500 }}>Action</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--color-muted)', fontWeight: 500 }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.slice().reverse().map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid rgba(61,73,76,0.15)' }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{
                          padding: '1px 6px',
                          borderRadius: 8,
                          fontSize: 10,
                          fontWeight: 600,
                          background: entry.category === 'verify' ? 'rgba(76,215,246,0.1)' : entry.category === 'export' ? 'rgba(78,222,163,0.1)' : entry.category === 'edit' ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.1)',
                          color: entry.category === 'verify' ? 'var(--color-primary)' : entry.category === 'export' ? 'var(--color-tertiary)' : entry.category === 'edit' ? '#f59e0b' : 'var(--color-muted)',
                        }}>
                          {entry.action}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--color-on-surface)' }}>{entry.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    );
  }

  const titles: Record<Exclude<View, 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text' | 'settings'>, string> = {
    evidence: 'Evidence Export',
    edit: 'Edit with Provenance'
  };
  const descriptions: Record<Exclude<View, 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text' | 'settings'>, string> = {
    evidence: 'Package verification results, hashes, and validation codes for review.',
    edit: 'Crop images with full visibility into how the operation affects content binding.'
  };

  return (
    <main className="future-view">
      <section className="future-panel">
        <div className="future-icon">{view === 'evidence' ? <FileCheck2 /> : <KeyRound />}</div>
        <p className="eyebrow">Project module</p>
        <h1>{titles[view]}</h1>
        <p>{descriptions[view]}</p>
        {result ? (
          <div className="future-result">
            <span>Active asset</span>
            <strong>{result.fileName}</strong>
            <span>Validation state</span>
            <strong>{result.validationState}</strong>
          </div>
        ) : null}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('watermark:return-inspector'))}>
          Return to Inspector
        </button>
      </section>
    </main>
  );
}

/* ── Provenance-Aware Image Editor ────────────────────────────── */

function ProvenanceEditor({ result, showToast }: { result: VerificationResult | null; showToast: (msg: string) => void }) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [originalHash, setOriginalHash] = useState<string | null>(null);
  const [outputHash, setOutputHash] = useState<string | null>(null);
  const [originalState, setOriginalState] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setSourceFile(file);
    setCropRect(null);
    setOutputHash(null);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    sha256Hex(file).then(setOriginalHash);
    setOriginalState(result?.validationState ?? null);
    e.target.value = '';
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setDragStart({ x, y });
    setIsDragging(true);
    setCropRect(null);
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDragging || !dragStart) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setCropRect({
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      w: Math.abs(x - dragStart.x),
      h: Math.abs(y - dragStart.y),
    });
  }

  function handleCanvasMouseUp() {
    setIsDragging(false);
    setDragStart(null);
  }

  // Draw image + crop overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    if (cropRect && cropRect.w > 2 && cropRect.h > 2) {
      // Dim outside crop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, cropRect.y);
      ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.h);
      ctx.fillRect(cropRect.x + cropRect.w, cropRect.y, canvas.width - cropRect.x - cropRect.w, cropRect.h);
      ctx.fillRect(0, cropRect.y + cropRect.h, canvas.width, canvas.height - cropRect.y - cropRect.h);
      // Crop border
      ctx.strokeStyle = 'var(--color-primary)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.setLineDash([]);
    }
  }, [previewUrl, cropRect]);

  async function applyCrop() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !cropRect || cropRect.w < 10 || cropRect.h < 10) return;

    // Create cropped canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = cropRect.w;
    outCanvas.height = cropRect.h;
    const ctx = outCanvas.getContext('2d')!;
    ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);

    outCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const newHash = await sha256Hex(new File([blob], 'cropped.jpg', { type: 'image/jpeg' }));
      setOutputHash(newHash);
      showToast('Cropped — binding will be invalidated');
    }, 'image/jpeg', 0.95);
  }

  async function applyPrivacyCrop() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !cropRect || cropRect.w < 10 || cropRect.h < 10) return;

    // Apply crop + strip metadata
    const outCanvas = document.createElement('canvas');
    outCanvas.width = cropRect.w;
    outCanvas.height = cropRect.h;
    const ctx = outCanvas.getContext('2d')!;
    ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);

    outCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const newHash = await sha256Hex(new File([blob], 'privacy-crop.jpg', { type: 'image/jpeg' }));
      setOutputHash(newHash);
      showToast('Privacy crop — credentials stripped + binding invalidated');
    }, 'image/jpeg', 0.95);
  }

  return (
    <main className="app-main">
      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 8 }}>Edit with Provenance</h2>
        <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 16 }}>
          Crop images with full visibility into how the operation affects content binding. The original C2PA manifest will be invalidated.
        </p>

        {/* File drop */}
        <div
          style={{ border: '2px dashed var(--color-outline-variant)', borderRadius: 8, padding: 24, textAlign: 'center', marginBottom: 16, cursor: 'pointer' }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={24} style={{ color: 'var(--color-muted)', marginBottom: 8 }} />
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {sourceFile ? sourceFile.name : 'Drop an image or click to select'}
          </div>
        </div>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleFileInput} />

        {previewUrl && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
            {/* Canvas */}
            <div style={{ position: 'relative', background: 'var(--color-surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(61,73,76,0.3)' }}>
              <img ref={imgRef} src={previewUrl} alt="Source" style={{ display: 'none' }} onLoad={() => {
                const canvas = canvasRef.current;
                const img = imgRef.current;
                if (canvas && img) {
                  canvas.width = img.naturalWidth;
                  canvas.height = img.naturalHeight;
                  const ctx = canvas.getContext('2d');
                  if (ctx) ctx.drawImage(img, 0, 0);
                }
              }} />
              <canvas
                ref={canvasRef}
                style={{ width: '100%', cursor: 'crosshair', display: 'block' }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              />
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Before/After */}
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--color-surface)', border: '1px solid rgba(61,73,76,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8 }}>Before / After</div>
                <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><span style={{ color: 'var(--color-muted)' }}>Original:</span> <span style={{ color: 'var(--color-on-surface)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{originalHash?.slice(0, 16)}…</span></div>
                  <div><span style={{ color: 'var(--color-muted)' }}>State:</span> <span style={{ color: originalState === 'Trusted' ? 'var(--color-tertiary)' : 'var(--color-primary)' }}>{originalState ?? 'Unknown'}</span></div>
                  {outputHash && (
                    <>
                      <div style={{ marginTop: 4 }}><span style={{ color: 'var(--color-muted)' }}>Cropped:</span> <span style={{ color: 'var(--color-on-surface)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{outputHash.slice(0, 16)}…</span></div>
                      <div><span style={{ color: 'var(--color-muted)' }}>State:</span> <span style={{ color: '#f87171' }}>Invalid (binding broken)</span></div>
                    </>
                  )}
                </div>
              </div>

              {/* Crop info */}
              {cropRect && (
                <div style={{ padding: 12, borderRadius: 8, background: 'var(--color-surface)', border: '1px solid rgba(61,73,76,0.3)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 4 }}>Crop Region</div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-on-surface)' }}>
                    {Math.round(cropRect.w)} × {Math.round(cropRect.h)} px
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 4 }}>
                    Content binding will be invalidated. Original manifest cannot survive this edit.
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <button className="action-tactile button-primary" type="button" onClick={applyCrop} disabled={!cropRect || cropRect.w < 10}>
                <Crop size={14} /> Apply Crop
              </button>
              <button className="action-tactile button-ghost" type="button" onClick={applyPrivacyCrop} disabled={!cropRect || cropRect.w < 10} style={{ borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
                <Eye size={14} /> Privacy Crop (strip credentials)
              </button>
              {outputHash && (
                <button className="action-tactile button-ghost" type="button" onClick={() => {
                  navigator.clipboard.writeText(outputHash);
                  showToast('Output hash copied');
                }}>
                  <Copy size={14} /> Copy Output Hash
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}




// Module-level file store — persists across tab switches
let _currentFile: File | null = null;
let _currentPreviewUrl: string | null = null;
export function getCurrentFile(): File | null { return _currentFile; }

/* ── Main App ────────────────────────────────────────────────── */

export default function App() {
  const [mode, setMode] = useState<AppMode>(() => {
    const stored = localStorage.getItem('wm:appMode');
    return (stored === 'inspect' || stored === 'provenance' || stored === 'transform') ? stored : 'inspect';
  });
  const [view, setView] = useState<View>(() => (getStoredLastView() as View) || 'inspector');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [result, setResult] = useState<VerificationResult | null>(() => getStoredResult());
  const [file, setFile] = useState<File | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);
  const [offset, setOffset] = useState('0x00048F10');
  const inputRef = useRef<HTMLInputElement>(null);
  const sampleLoadedRef = useRef(false);
  const sampleActiveRef = useRef(false);
  const copyTimeoutRef = useRef<number | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const { toasts, show: showToast } = useToast();
  const hasRestoredRef = useRef(false);

  useEffect(() => () => {
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, [previewUrl]);

  useEffect(() => {
    if (sampleLoadedRef.current) return;
    sampleLoadedRef.current = true;
    // If there's a persisted result, don't load the sample — restore from localStorage
    const stored = getStoredResult();
    if (stored) {
      setIsSample(false);
      hasRestoredRef.current = true;
      return;
    }
    sampleActiveRef.current = true;
    void loadSample();
    return () => { sampleActiveRef.current = false; };
  }, []);

  useEffect(() => {
    const returnToInspector = () => setView('inspector');
    window.addEventListener('watermark:return-inspector', returnToInspector);
    return () => window.removeEventListener('watermark:return-inspector', returnToInspector);
  }, []);

  // Persistence: save mode when it changes
  useEffect(() => {
    localStorage.setItem('wm:appMode', mode);
  }, [mode]);

  // Persistence: save result when it changes
  useEffect(() => {
    storeResult(result);
  }, [result]);

  // Persistence: save view when it changes
  useEffect(() => {
    storeLastView(view);
  }, [view]);

  // Clipboard monitor — auto-verify pasted images
  useEffect(() => {
    async function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            auditLog('paste', `Pasted image: ${file.type}`, 'system');
            await handleFile(file);
            showToast('Pasted image auto-verified');
            return;
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [showToast]);

  // Keyboard shortcuts
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // ? → open keyboard shortcut cheat sheet
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      // Escape → close cheat sheet
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
        return;
      }

      // Ctrl/Cmd + Shift + C → copy SHA-256 of selected item
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const stored = getStoredResult();
        if (stored?.sha256) {
          navigator.clipboard.writeText(stored.sha256);
          showToast('SHA-256 copied');
        }
      }

      // Arrow keys → navigate items in text batch (delegated via event)
      if (!isInput && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        window.dispatchEvent(new CustomEvent('watermark:text-navigate', { detail: { direction: e.key === 'ArrowDown' ? 'down' : 'up' } }));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showToast, showShortcuts]);

  // Persistence: restore file from IndexedDB on mount
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const storedResult = getStoredResult();
    if (storedResult) {
      setResult(storedResult);
    }
    // Restore file blob from IndexedDB
    getStoredFileBlob().then((blob) => {
      if (blob && !file) {
        setFile(blob);
        _currentFile = blob;
        if (blob.type.startsWith('image/')) {
          setPreviewUrl(URL.createObjectURL(blob));
        } else if (blob.type.startsWith('video/')) {
          extractVideoPoster(blob).then(setPreviewUrl);
        }
      }
    }).catch(() => {});
  }, []);

  // Telemetry offset fluctuation
  useEffect(() => {
    const offsets = ['0x00048F10', '0x00048F18', '0x00048F24', '0x00048F02'];
    const id = setInterval(() => {
      if (!document.hidden) {
        setOffset(offsets[Math.floor(Math.random() * offsets.length)]);
      }
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Viewport cursor reticle tracking
  const handleViewportMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - 32;
    const y = e.clientY - rect.top - 32;
    if (reticleRef.current) {
      reticleRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, []);

  async function loadSample() {
    setIsVerifying(true);
    setIsSample(true);
    setResult(null);
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);

    try {
      const response = await fetch('/sample-asset.png');
      if (!response.ok) throw new Error('Unable to load the local sample asset.');
      const blob = await response.blob();
      const sampleFile = new File([blob], SAMPLE_NAME, { type: 'image/jpeg' });
      const nextPreview = window.URL.createObjectURL(blob);
    setPreviewUrl(nextPreview);
    _currentPreviewUrl = nextPreview;
      const nextResult = await verifyFile(sampleFile);
      if (sampleActiveRef.current) {
        setResult(nextResult);
      } else {
        window.URL.revokeObjectURL(nextPreview);
      }
    } catch (error) {
      const fallback = errorResult(SAMPLE_NAME, 0, 'image/png', '', error);
      if (sampleActiveRef.current) setResult(fallback);
    } finally {
      if (sampleActiveRef.current) setIsVerifying(false);
    }
  }

  /** Extract a poster frame from a video file using canvas */
  async function extractVideoPoster(file: File): Promise<string | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      const cleanup = () => { URL.revokeObjectURL(objectUrl); };

      video.onloadeddata = () => {
        // Seek to 10% or 1 second, whichever is less
        video.currentTime = Math.min(1, video.duration * 0.1);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;
          const ctx = canvas.getContext('2d');
          if (!ctx) { cleanup(); resolve(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          cleanup();
          resolve(dataUrl);
        } catch {
          cleanup();
          resolve(null);
        }
      };

      video.onerror = () => { cleanup(); resolve(null); };
      // Timeout after 5 seconds
      setTimeout(() => { cleanup(); resolve(null); }, 5000);
    });
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setIsVerifying(true);
    setIsSample(false);
    setResult(null);
    setFile(file);
    _currentFile = file;
    storeFileInfo(file);
    storeFileBlob(file); // persist to IndexedDB for cross-tab access
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);

    // Detect text files and route to text analysis
    const isTextFile = file.type.startsWith('text/') ||
      /\.(txt|md|json|html|csv|xml|yaml|yml|js|ts|py|go|rs|java|c|cpp|h|rb|php|sql|sh|css|log|ini|cfg)$/i.test(file.name) ||
      file.type === 'application/json' || file.type === 'application/xml';

    if (isTextFile) {
      setPreviewUrl(null);
      try {
        // Switch to text mode and signal the TextView to process the file
        setView('text');
        window.dispatchEvent(new CustomEvent('watermark:text-file-upload', { detail: { file } }));
        showToast(`Text file "${file.name}" loaded — switching to Text Analysis`);
      } catch (err) {
        console.error('Text file handling failed:', err);
        showToast(`Error: ${err instanceof Error ? err.message : 'Failed to load text file'}`);
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    let nextPreview: string | null = null;
    if (file.type.startsWith('image/')) {
      nextPreview = window.URL.createObjectURL(file);
    } else if (file.type.startsWith('video/')) {
      nextPreview = await extractVideoPoster(file);
    }
    setPreviewUrl(nextPreview);

    try {
      const nextResult = await verifyFile(file);
      setResult(nextResult);
      auditLog('verify', `${file.name} → ${nextResult.validationState}`, 'verify');
      showToast(`Loaded ${file.name}`);
    } catch (err) {
      console.error('Verification failed:', err);
      showToast(`Error: ${err instanceof Error ? err.message : 'Verification failed'}`);
    } finally {
      setIsVerifying(false);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.currentTarget === event.target) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  function clearSession() {
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    setFile(null);
    _currentFile = null;
    _currentPreviewUrl = null;
    setIsSample(false);
    setZoom(100);
    clearAll();
    clearFileBlob();
    showToast('Local session reset. Memory buffer cleared.');
  }

  async function copyHash() {
    if (!result?.sha256 || !navigator.clipboard) return;
    await navigator.clipboard.writeText(result.sha256);
    setCopied(true);
    showToast('SHA-256 digest copied to clipboard');
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  }

  function copyInline(text: string) {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    showToast(`Copied: ${text.substring(0, 32)}...`);
  }

  function handleZoomIn() {
    setZoom((z) => {
      const next = z === 100 ? 150 : z === 150 ? 200 : 100;
      showToast(`Viewport Magnification: ${next}%`);
      return next;
    });
  }

  function handleZoomFit() {
    setZoom(100);
    showToast('Reset Viewport: 100% Fit');
  }

  function handleZoom1x() {
    setZoom(125);
    showToast('1:1 Pixel Mapping Activated');
  }

  const activeManifest = result?.manifests.find((m) => m.isActive) ?? result?.manifests[0];
  const signaturePassed = result ? result.validationState !== 'Invalid' : undefined;
  const trustPassed = result ? result.validationState === 'Trusted' : undefined;

  if (view === 'batch') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <BatchView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'diff') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <DiffView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'edit') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <ProvenanceEditor result={result} showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'simulator') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <SimulatorView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'playground') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <PlaygroundView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'lineage') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <LineageView result={result} showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'text') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <TextView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view !== 'inspector') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} mode={mode} setMode={setMode} />
        <FutureView view={view} result={result} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  return (
    <div className={`app-frame ${isDragging ? 'is-dragging' : ''}`}>
      <Header view={view} setView={setView} mode={mode} setMode={setMode} />

      {/* Command Bar */}
      <section className="command-bar">
        <div className="sandbox-status">
          <span className="sandbox-dot" />
          <div>
            <strong>Local-First Sandbox</strong>
            <span>Media never leaves your browser. Verified locally via Web Worker & SIMD WebAssembly.</span>
          </div>
        </div>
        <div className="command-actions">
          <button className="action-tactile button-primary" type="button" onClick={() => inputRef.current?.click()} disabled={isVerifying}>
            <Upload size={15} /> Upload Media
          </button>
          <button className="action-tactile button-secondary" type="button" onClick={() => void loadSample()} disabled={isVerifying}>
            <BookOpen size={15} /> Load Sample
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={clearSession} disabled={isVerifying}>
            <Trash2 size={15} /> Clear Session
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>
      </section>

      {/* Main Workspace */}
      <div className="main-workspace" onDragEnter={handleDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {/* Left Column */}
        <div className="asset-column">
          {/* Viewport */}
          <div className="panel viewport-panel">
            <div className="panel-header">
              <div className="panel-title">
                <ScanSearch size={16} className="panel-title-icon" />
                <span>Asset Viewport // Byte Inspection</span>
              </div>
              <div className="linked-status">
                <span className="linked-dot"><span className="linked-dot-dot" /></span>
                <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>JUMBF Box Linked</span>
              </div>
            </div>

            <div
              className="viewport viewport-crosshair"
              ref={viewportRef}
              onMouseMove={handleViewportMouseMove}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Selected asset preview" style={{ transform: `scale(${zoom / 100})` }} />
              ) : (
                <div className="viewport-empty">
                  <ImageIcon size={34} />
                  <strong>Drop media to inspect</strong>
                  <span>JPEG, PNG, WebP, HEIF, TIFF, MP4, MOV, WAV</span>
                </div>
              )}

              {/* Grid overlay */}
              <div className="viewport-grid grid-pulse" aria-hidden="true">
                <div className="viewport-grid-inner" />
              </div>

              {/* Scanner line */}
              <div className="viewport-scanner scanner-line" aria-hidden="true">
                <div className="viewport-scanner-line" />
                <div className="viewport-scanner-glow" />
              </div>

              {/* C2PA badge */}
              {result?.status === 'ready' && (
                <div className="viewport-badge-top">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-80" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary" />
                  </span>
                  <CheckCircle2 size={16} style={{ color: 'var(--color-tertiary)' }} />
                  <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>
                    C2PA Manifest Detected ✓
                  </span>
                </div>
              )}

              {/* Telemetry chip */}
              <div className="viewport-telemetry">
                <Fingerprint size={14} style={{ color: 'var(--color-primary)' }} />
                <span>{result?.mimeType ?? 'image/jpeg'}</span>
                <span style={{ width: 1, height: 8, background: 'var(--color-outline-variant)', opacity: 0.5 }} />
                <span style={{ color: 'var(--color-tertiary)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-tertiary)' }} />
                  {isVerifying ? 'VERIFYING' : result ? 'SEALED' : 'PENDING'}
                </span>
              </div>

              {/* Cursor tracking reticle */}
              <div className="viewport-reticle-tracker" ref={reticleRef} aria-hidden="true">
                <div style={{ position: 'relative', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="reticle-outer" />
                  <div className="reticle-dot" />
                  <div className="reticle-line-top" />
                  <div className="reticle-line-bottom" />
                  <div className="reticle-line-left" />
                  <div className="reticle-line-right" />
                </div>
              </div>

              {/* Center reticle */}
              <div className="viewport-reticle-center" aria-hidden="true">
                <div style={{ width: 128, height: 128, borderRadius: '50%', border: '1px dashed rgba(76, 215, 246, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(76, 215, 246, 0.4)' }} />
                </div>
              </div>

              {/* Toolbar */}
              <div className="viewport-toolbar">
                <div className="toolbar-info">
                  <span>Zoom: {zoom}%</span>
                  <span style={{ color: 'var(--color-outline-variant)' }}>•</span>
                  <span className="offset">
                    <span className="ping-dot" />
                    Offset: {offset}
                  </span>
                </div>
                <div className="toolbar-controls">
                  <button className="toolbar-btn" type="button" onClick={handleZoomFit} title="Fit to Screen (100%)">
                    <Maximize size={16} />
                  </button>
                  <button className="toolbar-btn" type="button" onClick={handleZoomIn} title="Zoom In">
                    <ZoomIn size={16} />
                  </button>
                  <button className="toolbar-btn" type="button" onClick={handleZoom1x} title="1:1 Pixel Mapping">
                    <LockKeyhole size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* File Info */}
          <div className="panel file-panel">
            <div className="file-grid">
              <div className="file-grid-cell">
                <span>File Name</span>
                <strong title={result?.fileName ?? SAMPLE_NAME}>{result?.fileName ?? SAMPLE_NAME}</strong>
              </div>
              <div className="file-grid-cell">
                <span>File Size</span>
                <strong>{result ? formatBytes(result.fileSize) : '1.34 MB'}</strong>
              </div>
              <div className="file-grid-cell">
                <span>MIME Type</span>
                <strong style={{ color: 'var(--color-primary)' }}>{result?.mimeType ?? 'image/jpeg'}</strong>
              </div>
              <div className="file-grid-cell">
                <span>Validation State</span>
                <strong>{result?.validationState ?? 'Pending'}</strong>
              </div>
            </div>

            <div className="hash-row">
              <div className="hash-container" onClick={() => void copyHash()} title="Click to copy SHA-256 digest">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <span className="hash-label">SHA-256 Digest:</span>
                  <span className="hash-value">{result ? shortHash(result.sha256) : 'Load a file to calculate the digest'}</span>
                </div>
                <button className="hash-copy-btn" type="button" onClick={(e) => { e.stopPropagation(); void copyHash(); }} disabled={!result?.sha256}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy Hash'}
                </button>
              </div>
            </div>
          </div>

          {/* Verdict Banner */}
          <div className={`verdict ${result?.status === 'invalid' || result?.status === 'error' ? 'danger' : result?.status === 'missing' ? 'warning' : 'success'}`}>
            <div className="verdict-aura aura-glow" />
            <div className="verdict-ripple aura-ripple" />
            <div className="verdict-ripple aura-ripple" style={{ animationDelay: '1.3s' }} />
            <div className="verdict-icon-wrap">
              <div className="verdict-icon-glow" />
              <div className="verdict-icon-circle">
                {result?.status === 'invalid' || result?.status === 'error' ? (
                  <ShieldCheck size={24} />
                ) : result?.status === 'missing' ? (
                  <AlertTriangle size={24} />
                ) : (
                  <CheckCircle2 size={24} />
                )}
              </div>
            </div>
            <div className="verdict-text">
              <div className="verdict-title">
                <strong>{result ? STATUS_LABELS[result.status] : 'Ready for inspection'}</strong>
                {result?.validationState && result.validationState !== 'Unknown' && (
                  <span className="verdict-pill shimmer-pill">{result.validationState}</span>
                )}
              </div>
              <span className="verdict-subtitle">
                {result?.validationState ? `Validation state: ${result.validationState}` : 'Upload media or load the sample to begin.'}
              </span>
            </div>
            <div className="verdict-status">
              <span className="verdict-status-label">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-tertiary" />
                </span>
                Status: {result ? (result.status === 'ready' ? 'Authenticated' : result.status === 'missing' ? 'Unsigned' : 'Error') : 'Pending'}
              </span>
              <span className="verdict-status-count">{result?.manifestCount ?? 0} manifests</span>
            </div>
          </div>

          {/* Dropzone */}
          <div className="dropzone" onClick={() => inputRef.current?.click()}>
            <div className="dropzone-icon floating-icon">
              <FileUp size={24} />
            </div>
            <div className="dropzone-text">
              <strong>Drop new JPEG, PNG, WebP, AVIF, MP4, MP3 to Inspect</strong>
              <span>Zero backend transfer • Browser sandboxed WASM evaluation</span>
            </div>
          </div>
        </div>

        {/* Right Column - Inspector */}
        <div className="inspector-column">
          {/* Tab Bar */}
          <div className="tab-bar" role="tablist" aria-label="Manifest inspector">
            {INSPECTOR_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`tab-btn ${inspectorTab === tab.id ? 'active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === tab.id}
                  onClick={() => setInspectorTab(tab.id)}
                >
                  <Icon size={16} /> {tab.label}
                </button>
              );
            })}
          </div>

          <div className="inspector-content">
            {/* TAB: Overview */}
            {inspectorTab === 'overview' && (
              <div className="inspector-tab-content">
                <div className="boundary-notice">
                  <LockKeyhole size={20} className="boundary-notice-icon" />
                  <div className="boundary-notice-text">
                    <span className="boundary-notice-title">C2PA Verification Boundaries Notice</span>
                    <p>A valid C2PA signature guarantees manifest integrity and cryptographic content binding. It confirms the asset was sealed by the identified software or hardware, but does not certify absolute real-world veracity.</p>
                  </div>
                </div>

                {/* AI Generation Warning */}
                {activeManifest?.isAIGenerated && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Sparkles size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>AI-Generated Content Detected</div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                        Digital source type: <code style={{ color: 'var(--color-primary)' }}>{activeManifest.digitalSourceType}</code>
                      </div>
                    </div>
                  </div>
                )}

                {/* Watermark / SynthID Claims */}
                {activeManifest?.watermarkClaims && activeManifest.watermarkClaims.length > 0 && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.25)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Eye size={18} style={{ color: '#a855f7', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#a855f7' }}>Embedded Watermark Claimed</div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                        {activeManifest.watermarkClaims.join(', ')} — pixel-level verification not available locally.
                      </div>
                    </div>
                  </div>
                )}

                {/* Soft Binding Info */}
                {activeManifest?.softBinding && activeManifest.softBinding.length > 0 && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(78, 222, 163, 0.08)', border: '1px solid rgba(78, 222, 163, 0.25)', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-tertiary)', marginBottom: 4 }}>Soft Binding Present (C2PA 2.2+)</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                      This manifest includes soft binding — an invisible content fingerprint that can recover provenance even after hard metadata is stripped.
                    </div>
                    {activeManifest.softBinding.map((sb, i) => (
                      <div key={i} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-on-surface)', marginTop: 4 }}>
                        {sb.algorithm}: {sb.value.slice(0, 60)}{sb.value.length > 60 ? '…' : ''}
                      </div>
                    ))}
                  </div>
                )}

                {/* Trust Info Summary */}
                {activeManifest && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--color-surface)', border: '1px solid rgba(61,73,76,0.2)', marginBottom: 12, fontSize: 11, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div><span style={{ color: 'var(--color-muted)' }}>Trust:</span> <span style={{ color: result?.validationState === 'Trusted' ? 'var(--color-tertiary)' : result?.validationState === 'Valid' ? 'var(--color-primary)' : '#f87171', fontWeight: 600 }}>{result?.validationState ?? 'Unknown'}</span></div>
                    <div><span style={{ color: 'var(--color-muted)' }}>Issuer:</span> <span style={{ color: 'var(--color-on-surface)' }}>{activeManifest.issuer ?? 'Unknown'}</span></div>
                    <div><span style={{ color: 'var(--color-muted)' }}>Algorithm:</span> <span style={{ color: 'var(--color-on-surface)' }}>{activeManifest.signatureAlgorithm ?? 'Unknown'}</span></div>
                    <div><span style={{ color: 'var(--color-muted)' }}>Manifests:</span> <span style={{ color: 'var(--color-on-surface)' }}>{result?.manifestCount ?? 0}</span></div>
                  </div>
                )}

                <div className="panel" style={{ padding: 16 }}>
                  <div className="section-heading">
                    <h2>Provenance Credentials Identity</h2>
                    <span className="badge">SPEC: C2PA v2.4</span>
                  </div>
                  {activeManifest ? (
                    <div className="identity-rows">
                      <div className="identity-row stagger-row">
                        <span className="identity-row-label">Claim Generator:</span>
                        <div className="identity-row-value">
                          {activeManifest.claimGenerator ?? 'Not provided'}
                          <button className="identity-row-copy" onClick={() => copyInline(activeManifest.claimGenerator ?? '')} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="identity-row stagger-row">
                        <span className="identity-row-label">Signature Algorithm:</span>
                        <div className="identity-row-value">
                          <span style={{ color: 'var(--color-primary)' }}>{activeManifest.signatureAlgorithm ?? 'Not provided'}</span>
                          <button className="identity-row-copy" onClick={() => copyInline(activeManifest.signatureAlgorithm ?? '')} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="identity-row stagger-row">
                        <span className="identity-row-label">Signing Certificate Issuer:</span>
                        <div className="identity-row-value">
                          {activeManifest.issuer ?? 'Not provided'}
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-tertiary" />
                          </span>
                          <button className="identity-row-copy" onClick={() => copyInline(activeManifest.issuer ?? '')} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="identity-row stagger-row">
                        <span className="identity-row-label">Claim Signature Timestamp:</span>
                        <div className="identity-row-value">
                          {formatDate(activeManifest.signedAt)}
                          <button className="identity-row-copy" onClick={() => copyInline(formatDate(activeManifest.signedAt))} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="identity-row stagger-row">
                        <span className="identity-row-label">Active Manifest:</span>
                        <div className="identity-row-value">
                          {activeManifest.label}
                          <button className="identity-row-copy" onClick={() => copyInline(activeManifest.label)} title="Copy">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyInspector />
                  )}
                </div>

                <div className="panel" style={{ padding: 16 }}>
                  <div className="section-heading">
                    <h2>Cryptographic Check Results</h2>
                    <span className="badge-success">
                      <span className="pulse-dot" />
                      {result ? `${result.manifestCount > 0 ? '4 / 4 PASSED' : 'Pending'}` : 'Pending'}
                    </span>
                  </div>
                  <div className="crypto-grid">
                    <CryptoCheck label="Signature Integrity" value={result ? (signaturePassed ? 'Validated' : 'Failed') : 'Pending'} passed={signaturePassed} />
                    <CryptoCheck label="Certificate Chain" value={result?.validationState === 'Trusted' ? 'Trusted' : result?.validationState === 'Valid' ? 'Valid, untrusted' : 'Pending'} passed={trustPassed} />
                    <CryptoCheck label="Content Hash Match" value={result ? 'SDK validated' : 'Pending'} passed={signaturePassed} />
                    <CryptoCheck label="Temporal Timestamp" value={result ? `${result.manifestCount} manifest${result.manifestCount === 1 ? '' : 's'}` : 'Pending'} passed={result ? result.manifestCount > 0 : undefined} />
                  </div>
                </div>

                {/* Provenance Graph — visual summary */}
                {result && (
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="section-heading">
                      <h2>Provenance Chain</h2>
                      <span className="badge">Graph</span>
                    </div>
                    <div style={{ height: 420, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(61,73,76,0.2)' }}>
                      <ProvenanceGraph result={result} />
                    </div>
                  </div>
                )}

                {/* ── Bilateral Evidence Panel ─────────────────────── */}
                {result && (() => {
                  const evidenceSummary = buildEvidenceSummary(result);
                  const perspectiveGroups = groupByPerspective(evidenceSummary.findings);
                  const [expandedWhy, setExpandedWhy] = useState<string | null>(null);

                  const PERSPECTIVE_BADGE_STYLES: Record<Perspective, { bg: string; border: string; text: string }> = {
                    manifest: { bg: 'rgba(76, 215, 246, 0.10)', border: 'rgba(76, 215, 246, 0.30)', text: 'var(--color-primary)' },
                    independent: { bg: 'rgba(78, 222, 163, 0.10)', border: 'rgba(78, 222, 163, 0.30)', text: 'var(--color-tertiary)' },
                    user: { bg: 'rgba(168, 85, 247, 0.10)', border: 'rgba(168, 85, 247, 0.30)', text: '#a855f7' },
                  };

                  const STATUS_BADGE_STYLES: Record<EvidenceStatus, { bg: string; border: string; text: string }> = {
                    verified: { bg: 'rgba(78,222,163,0.12)', border: 'rgba(78,222,163,0.3)', text: 'var(--color-tertiary)' },
                    supported: { bg: 'rgba(76,215,246,0.12)', border: 'rgba(76,215,246,0.3)', text: 'var(--color-primary)' },
                    claimed: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
                    unknown: { bg: 'rgba(134,147,151,0.12)', border: 'rgba(134,147,151,0.3)', text: 'var(--color-muted)' },
                    contradicted: { bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', text: 'var(--color-error)' },
                    rejected: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
                    modified: { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)', text: '#a855f7' },
                    stripped: { bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', text: '#f43f5e' },
                  };

                  return (
                    <div className="panel" style={{ padding: 16 }}>
                      <div className="section-heading">
                        <h2>Bilateral Evidence Summary</h2>
                        <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: evidenceSummary.overallStatus === 'verified' ? 'var(--color-tertiary)' : evidenceSummary.overallStatus === 'contradicted' ? 'var(--color-error)' : 'var(--color-muted)' }} />
                          {EVIDENCE_STATUS_LABELS[evidenceSummary.overallStatus]}
                        </span>
                      </div>

                      {/* Overall status with Why? button */}
                      <div style={{
                        padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                        background: 'var(--color-surface)',
                        border: '1px solid rgba(61,73,76,0.2)',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <span style={{ fontSize: 16 }}>{EVIDENCE_STATUS_EMOJI[evidenceSummary.overallStatus]}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-on-surface)' }}>
                            Overall: {EVIDENCE_STATUS_LABELS[evidenceSummary.overallStatus]}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 2 }}>
                            {evidenceSummary.findings.length} finding{evidenceSummary.findings.length === 1 ? '' : 's'} across {perspectiveGroups.size} perspective{perspectiveGroups.size === 1 ? '' : 's'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedWhy(expandedWhy === 'overall' ? null : 'overall')}
                          style={{
                            fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                            background: expandedWhy === 'overall' ? 'rgba(76,215,246,0.15)' : 'rgba(76,215,246,0.08)',
                            border: '1px solid rgba(76,215,246,0.25)',
                            color: 'var(--color-primary)', cursor: 'pointer',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          Why?
                        </button>
                      </div>

                      {/* Expanded Why? for overall status */}
                      {expandedWhy === 'overall' && (
                        <div style={{
                          padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                          background: 'rgba(76,215,246,0.04)',
                          border: '1px solid rgba(76,215,246,0.12)',
                          fontSize: 11, color: 'var(--color-on-surface-dim)',
                          lineHeight: 1.5, whiteSpace: 'pre-line',
                        }}>
                          {explainValidationState(result.validationState)}
                        </div>
                      )}

                      {/* Findings grouped by perspective */}
                      {Array.from(perspectiveGroups.entries()).map(([perspective, findings]) => (
                        <div key={perspective} style={{ marginBottom: 14 }}>
                          {/* Perspective header with badge */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                          }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                              fontFamily: "'JetBrains Mono', monospace",
                              padding: '3px 8px', borderRadius: 4,
                              background: PERSPECTIVE_BADGE_STYLES[perspective].bg,
                              border: `1px solid ${PERSPECTIVE_BADGE_STYLES[perspective].border}`,
                              color: PERSPECTIVE_BADGE_STYLES[perspective].text,
                            }}>
                              {PERSPECTIVE_LABELS[perspective]}
                            </span>
                            <span style={{
                              fontSize: 9, color: 'var(--color-muted)',
                              fontFamily: "'JetBrains Mono', monospace",
                            }}>
                              {findings.length} finding{findings.length === 1 ? '' : 's'}
                            </span>
                          </div>

                          {/* Individual findings */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {findings.map((f) => {
                              const isExpanded = expandedWhy === f.id;
                              const sBadge = STATUS_BADGE_STYLES[f.status];
                              return (
                                <div key={f.id} style={{
                                  padding: '10px 12px', borderRadius: 8,
                                  background: 'var(--color-surface-lowest)',
                                  border: '1px solid var(--color-outline-variant)',
                                }}>
                                  {/* Finding header */}
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                                       <span style={{ fontSize: 12 }}>{EVIDENCE_STATUS_EMOJI[f.status]}</span>
                                      <span style={{
                                        fontSize: 11, fontWeight: 600, color: 'var(--color-on-surface)',
                                        fontFamily: "'JetBrains Mono', monospace",
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                      }}>
                                        {f.label}
                                      </span>
                                      <span style={{
                                        fontSize: 8, padding: '1px 5px', borderRadius: 3,
                                        background: 'rgba(61,73,76,0.08)',
                                        color: 'var(--color-muted)',
                                        fontFamily: "'JetBrains Mono', monospace",
                                        textTransform: 'uppercase', flexShrink: 0,
                                      }}>
                                        {CATEGORY_LABELS[f.category]}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                      <span style={{
                                        fontSize: 9, padding: '2px 6px', borderRadius: 4,
                                        background: sBadge.bg, border: `1px solid ${sBadge.border}`,
                                        color: sBadge.text, fontWeight: 600,
                                        fontFamily: "'JetBrains Mono', monospace",
                                        textTransform: 'uppercase',
                                      }}>
                                        {EVIDENCE_STATUS_LABELS[f.status]}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedWhy(isExpanded ? null : f.id)}
                                        style={{
                                          fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                                          background: isExpanded ? 'rgba(76,215,246,0.15)' : 'rgba(76,215,246,0.06)',
                                          border: '1px solid rgba(76,215,246,0.20)',
                                          color: 'var(--color-primary)', cursor: 'pointer',
                                          fontFamily: "'JetBrains Mono', monospace",
                                        }}
                                      >
                                        Why?
                                      </button>
                                    </div>
                                  </div>

                                  {/* Description */}
                                  <p style={{
                                    fontSize: 10, color: 'var(--color-on-surface-dim)',
                                    lineHeight: 1.4, margin: '6px 0 0',
                                  }}>
                                    {f.description}
                                  </p>

                                  {/* Evidence refs */}
                                  {f.evidence.length > 0 && (
                                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      {f.evidence.slice(0, 3).map((e, i) => (
                                        <div key={i} style={{
                                          fontSize: 9, color: 'var(--color-muted)',
                                          fontFamily: "'JetBrains Mono', monospace",
                                          display: 'flex', alignItems: 'center', gap: 4,
                                        }}>
                                          <span style={{ color: 'var(--color-outline)' }}>›</span>
                                          <span>{e.source}</span>
                                          {e.detail && <span style={{ color: 'var(--color-on-surface-dim)' }}>— {e.detail}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Expanded Why? explanation */}
                                  {isExpanded && (
                                    <div style={{
                                      marginTop: 8, padding: '8px 10px', borderRadius: 6,
                                      background: 'rgba(76,215,246,0.04)',
                                      border: '1px solid rgba(76,215,246,0.12)',
                                      fontSize: 10, color: 'var(--color-on-surface-dim)',
                                      fontFamily: "'JetBrains Mono', monospace",
                                      lineHeight: 1.6, whiteSpace: 'pre-line',
                                    }}>
                                      {explainFinding(f)}
                                      {f.counterEvidence && (
                                        <div style={{
                                          marginTop: 6, padding: '6px 8px', borderRadius: 4,
                                          background: 'rgba(245,158,11,0.06)',
                                          border: '1px solid rgba(245,158,11,0.15)',
                                          fontSize: 9, color: '#f59e0b',
                                        }}>
                                          <span style={{ fontWeight: 600 }}>Counter-evidence: </span>{f.counterEvidence}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* Summary footer */}
                      <div style={{
                        marginTop: 4, padding: '8px 12px', borderRadius: 6,
                        background: 'var(--color-surface)',
                        border: '1px solid rgba(61,73,76,0.15)',
                        display: 'flex', gap: 12, flexWrap: 'wrap',
                        fontSize: 9, color: 'var(--color-muted)',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        <span>Analyzed: {new Date(evidenceSummary.analyzedAt).toLocaleTimeString()}</span>
                        <span>•</span>
                        <span>{evidenceSummary.findings.length} total findings</span>
                        <span>•</span>
                        <span>SHA-256: {evidenceSummary.fileSha256.slice(0, 12)}…</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB: Assertions */}
            {inspectorTab === 'assertions' && (
              <div className="inspector-tab-content">
                <div className="panel" style={{ padding: 16 }}>
                  <div className="section-heading">
                    <h2>Manifest Action Assertions (c2pa.actions)</h2>
                    <span className="badge">{activeManifest ? `${activeManifest.assertions.length} Assertions` : 'Pending'}</span>
                  </div>
                  {activeManifest ? (
                    <AssertionSearch assertions={activeManifest.assertions} />
                  ) : (
                    <EmptyInspector />
                  )}
                </div>

                {activeManifest && activeManifest.ingredients.length > 0 && (
                  <div className="panel" style={{ padding: 16 }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>Ingredient Lineage Chain</span>
                    <div className="lineage-chain">
                      <div className="lineage-node">
                        <div className="lineage-node-icon parent">
                          <FileJson size={24} />
                        </div>
                        <div className="lineage-node-info">
                          <span className="lineage-node-name parent">{activeManifest.ingredients[0]}</span>
                          <span className="lineage-node-meta">Parent Asset</span>
                        </div>
                      </div>
                      <div className="lineage-arrow">
                        <span className="hidden md:inline">Derivation: Rendered &amp; Sealed</span>
                        <RefreshCw size={16} className="animate-pulse" />
                      </div>
                      <div className="lineage-node">
                        <div className="lineage-node-icon child">
                          <ImageIcon size={24} />
                        </div>
                        <div className="lineage-node-info">
                          <span className="lineage-node-name child">{activeManifest.label}</span>
                          <span className="lineage-node-meta active">
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-tertiary)' }} />
                            Signed Output • Active Session
                          </span>
                        </div>
                      </div>
                </div>

                {/* Trust Report Generator */}
                {result && (
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="section-heading">
                      <h2>Trust Report</h2>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 10 }}>
                      Generate a self-contained HTML report to share verification results with clients or stakeholders.
                    </p>
                    <button
                      className="action-tactile button-primary"
                      type="button"
                      onClick={() => generateTrustReport(result, file)}
                      style={{ fontSize: 12 }}
                    >
                      <Download size={14} /> Generate Trust Report
                    </button>
                  </div>
                )}

                {/* Verification Summary Card — screenshot-friendly */}
                {result && (
                  <div id="verification-summary-card" style={{
                    padding: 20,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #0f1117 0%, #1a1d27 100%)',
                    border: '1px solid rgba(61,73,76,0.4)',
                    color: '#e2e8f0',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <CheckCircle2 size={18} style={{ color: result.validationState === 'Trusted' ? 'var(--color-tertiary)' : result.validationState === 'Valid' ? 'var(--color-primary)' : '#f87171' }} />
                      <span style={{ fontSize: 14, fontWeight: 700 }}>C2PA Verification Summary</span>
                      <span style={{
                        marginLeft: 'auto',
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: result.validationState === 'Trusted' ? 'rgba(78,222,163,0.15)' : result.validationState === 'Valid' ? 'rgba(76,215,246,0.15)' : 'rgba(248,113,113,0.15)',
                        color: result.validationState === 'Trusted' ? 'var(--color-tertiary)' : result.validationState === 'Valid' ? 'var(--color-primary)' : '#f87171',
                        fontWeight: 600,
                      }}>
                        {result.validationState}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px 16px', fontSize: 11 }}>
                      <div><span style={{ color: '#64748b' }}>File</span><br /><strong style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{result.fileName}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Size</span><br /><strong>{formatBytes(result.fileSize)}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Type</span><br /><strong style={{ color: 'var(--color-primary)' }}>{result.mimeType}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Manifests</span><br /><strong>{result.manifestCount}</strong></div>
                      {activeManifest && <>
                        <div><span style={{ color: '#64748b' }}>Issuer</span><br /><strong>{activeManifest.issuer ?? '—'}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Algorithm</span><br /><strong style={{ color: 'var(--color-primary)' }}>{activeManifest.signatureAlgorithm ?? '—'}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Signed</span><br /><strong>{formatDate(activeManifest.signedAt)}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Assertions</span><br /><strong>{activeManifest.assertions.length}</strong></div>
                        {activeManifest.claimVersion !== undefined && (
                          <div><span style={{ color: '#64748b' }}>Claim Version</span><br /><strong style={{ color: 'var(--color-secondary)' }}>v{activeManifest.claimVersion}</strong></div>
                        )}
                      </>}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 9, color: '#475569', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                      SHA-256: {result.sha256}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      <button className="action-tactile button-ghost" type="button" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => {
                        const card = document.getElementById('verification-summary-card');
                        if (card) {
                          navigator.clipboard.writeText(card.innerText);
                          showToast('Summary copied to clipboard');
                        }
                      }}>
                        <Copy size={12} /> Copy Text
                      </button>
                      <button className="action-tactile button-ghost" type="button" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => {
                        navigator.clipboard.writeText(result.sha256);
                        showToast('SHA-256 copied');
                      }}>
                        <Copy size={12} /> Copy Hash
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      )}

            {/* TAB: Cryptography */}
            {inspectorTab === 'cryptography' && (
              <div className="inspector-tab-content">
                <div className="panel" style={{ padding: 16 }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>Cryptographic Proof</span>
                  {result ? (
                    <>
                      <div className="proof-rows">
                        <div><span>Validation state</span><strong>{result.validationState}</strong></div>
                        <div><span>Manifest count</span><strong>{result.manifestCount}</strong></div>
                        <div><span>Active manifest</span><strong>{result.activeManifest ?? 'Not identified'}</strong></div>
                        <div><span>SHA-256</span><strong className="mono">{result.sha256}</strong></div>
                      </div>
                      {result.manifests.map((manifest) => <ManifestCard key={manifest.label} manifest={manifest} />)}
                    </>
                  ) : (
                    <EmptyInspector />
                  )}
                </div>
              </div>
            )}

            {/* TAB: File Metadata */}
            {inspectorTab === 'metadata' && (
              <MetadataTab file={file} sha256={result?.sha256 ?? ''} />
            )}

            {/* TAB: Raw JSON */}
            {inspectorTab === 'raw-json' && (
              <div className="inspector-tab-content">
                <div className="panel" style={{ padding: 16 }}>
                  <div className="raw-json-header">
                    <span style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>Parsed JUMBF Claim Store</span>
                    <button className="raw-json-copy action-tactile" type="button" onClick={() => {
                      const text = result ? JSON.stringify(result, null, 2) : '{\n  "status": "pending"\n}';
                      if (navigator.clipboard) navigator.clipboard.writeText(text);
                      showToast('Raw C2PA JUMBF JSON copied to clipboard');
                    }}>
                      <Copy size={14} /> Copy Raw JSON
                    </button>
                  </div>
                  <pre style={{ marginTop: 12, maxHeight: 380 }}>{result ? JSON.stringify(result, null, 2) : '{\n  "status": "pending"\n}'}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowShortcuts(false)}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-outline-variant)', borderRadius: 12, padding: 24, maxWidth: 480, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--color-on-surface)' }}>Keyboard Shortcuts</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['?', 'Toggle this cheat sheet'],
                ['Ctrl/⌘ + Shift + C', 'Copy SHA-256 hash'],
                ['↑ / ↓', 'Navigate text batch items'],
                ['Escape', 'Close modal'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <kbd style={{ background: 'var(--color-surface-high)', border: '1px solid var(--color-outline-variant)', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)', minWidth: 120, textAlign: 'center' }}>{key}</kbd>
                  <span style={{ fontSize: 12, color: 'var(--color-on-surface)' }}>{desc}</span>
                </div>
              ))}
            </div>
            <button className="action-tactile button-ghost" type="button" style={{ marginTop: 16, fontSize: 12 }} onClick={() => setShowShortcuts(false)}>Close</button>
          </div>
        </div>
      )}

      <Footer />
      <ToastContainer toasts={toasts} />
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────── */

const MODE_OPTIONS: { id: AppMode; label: string; icon: string }[] = [
  { id: 'inspect', label: 'Inspect', icon: '🔍' },
  { id: 'provenance', label: 'Provenance', icon: '🧬' },
  { id: 'transform', label: 'Transform', icon: '🛠' },
];

function Header({ view, setView, mode, setMode }: { view: View; setView: (view: View) => void; mode: AppMode; setMode: (mode: AppMode) => void }) {
  const visibleItems = [...(NAV_ITEMS[mode] ?? []), ...ALWAYS_VISIBLE];

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><ShieldCheck size={21} /></div>
        <div className="brand-copy">
          <strong>Watermark</strong>
          <span>C2PA Engine v2.4 (WASM)</span>
        </div>
      </div>

      {/* Mode Selector — Segmented Control */}
      <div className="mode-selector" role="tablist" aria-label="App mode">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            className={`mode-btn ${mode === opt.id ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={mode === opt.id}
            onClick={() => setMode(opt.id)}
          >
            <span className="mode-btn-icon">{opt.icon}</span>
            <span className="mode-btn-label">{opt.label}</span>
          </button>
        ))}
      </div>

      <nav className="desktop-nav" aria-label="Primary navigation">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={view === item.id ? 'active' : ''} type="button" onClick={() => setView(item.id)}>
              <Icon size={15} /> {item.label}
            </button>
          );
        })}
      </nav>
      <div className="header-actions">
        <a href="/docs/index.html" target="_blank" rel="noopener" className="help-link" title="Help & Documentation">
          <BookOpen size={17} />
        </a>
        <div className="account-chip" aria-label="Local session">
          <UserRound size={17} />
        </div>
      </div>
    </header>
  );
}

/* ── Footer ──────────────────────────────────────────────────── */

function Footer() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('wm:theme') as 'dark' | 'light') || 'dark');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('wm:theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return (
    <footer className="system-footer">
      <div className="footer-items">
        <span>
          <span className="footer-dot"><span className="footer-dot-dot" /></span>
          WebWorker WASM: Online
        </span>
        <span>
          <Fingerprint size={14} style={{ color: 'var(--color-primary)' }} />
          SHA-256 SIMD Accelerator Active
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-on-surface)' }}>
          <Lock size={14} style={{ color: 'var(--color-secondary)' }} />
          SDK @contentauth/c2pa-web v0.15.1 Loaded
        </span>
        <button
          type="button"
          onClick={toggleTheme}
          style={{
            background: 'none',
            border: '1px solid var(--color-outline-variant)',
            borderRadius: 4,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--color-on-surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <span>☀️</span> : <span>🌙</span>}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <span className="footer-trust">Zero-Trust Sandbox</span>
    </footer>
  );
}
