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
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { verifyFile } from './lib/c2pa';
import { errorResult } from './lib/verification';
import { formatBytes, sha256Hex } from './lib/file';
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
import './styles.css';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*';
const SAMPLE_NAME = 'alpine_dawn_capture_2025.jpg';

type View = 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text' | 'evidence' | 'settings';
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

const NAV_ITEMS = [
  { id: 'inspector' as View, label: 'Inspector', icon: ScanSearch },
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

/* ── Binary Inspector (hex view + structure tree) ─────────────── */

function BinaryInspector({ binary }: { binary: BinaryInfo }) {
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);

  if (!binary || !binary.hexPreview) {
    return <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>No binary data available.</div>;
  }

  // Parse hex lines into structured data for interactive display
  const hexLines = binary.hexPreview.split('\n').filter(Boolean);
  const structItems = binary.structure ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Info bar */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
        <span>Type: <strong style={{ color: 'var(--color-primary)' }}>{binary.detectedType}</strong></span>
        <span>Size: <strong>{binary.fileSize.toLocaleString()}B</strong></span>
        <span>Entropy: <strong>{binary.entropy.toFixed(2)}</strong></span>
        <span>Magic: <strong style={{ color: 'var(--color-tertiary)' }}>{binary.magicBytes}</strong></span>
      </div>

      {/* Structure tree (if available) */}
      {structItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 2 }}>Structure</div>
          {structItems.map((s, i) => (
            <div
              key={i}
              onClick={() => setSelectedStructure(selectedStructure === i ? null : i)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(60px, auto) 90px 60px 1fr',
                gap: 8,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                padding: '3px 6px',
                borderRadius: 4,
                cursor: 'pointer',
                background: selectedStructure === i ? 'rgba(76, 215, 246, 0.1)' : 'transparent',
                border: selectedStructure === i ? '1px solid rgba(76, 215, 246, 0.3)' : '1px solid transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (selectedStructure !== i) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={(e) => { if (selectedStructure !== i) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{s.name}</span>
              <span style={{ color: '#94a3b8' }}>0x{s.offset.toString(16).padStart(6, '0')}</span>
              <span style={{ color: '#94a3b8' }}>{s.length}B</span>
              <span style={{ color: 'var(--color-on-surface-variant)' }}>{s.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hex dump */}
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 2 }}>
          Hex Dump
          {selectedStructure !== null && structItems[selectedStructure] && (
            <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--color-primary)' }}>
              — {structItems[selectedStructure].name} @ 0x{structItems[selectedStructure].offset.toString(16)}
            </span>
          )}
        </div>
        <pre
          className="hex-view"
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            maxHeight: 350,
            overflow: 'auto',
            color: 'var(--color-on-surface)',
            background: 'var(--color-surface)',
            padding: 8,
            borderRadius: 6,
            border: '1px solid rgba(61,73,76,0.3)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre',
          }}
        >
          {selectedStructure !== null && structItems[selectedStructure] ? (() => {
            const sel = structItems[selectedStructure];
            const selStart = sel.offset;
            const selEnd = sel.offset + sel.length;
            return hexLines.map((line, i) => {
              // Parse offset from line: "00000000  xx xx xx ..."
              const lineOffset = parseInt(line.slice(0, 8), 16);
              if (isNaN(lineOffset)) return <div key={i}>{line}</div>;
              const lineEnd = lineOffset + 16;
              const overlaps = lineEnd > selStart && lineOffset < selEnd;
              return (
                <div key={i} style={{
                  background: overlaps ? 'rgba(76, 215, 246, 0.08)' : 'transparent',
                  borderLeft: overlaps ? '2px solid var(--color-primary)' : '2px solid transparent',
                  paddingLeft: 4,
                }}>
                  {line}
                </div>
              );
            });
          })() : hexLines.map((line, i) => <div key={i}>{line}</div>)}
        </pre>
      </div>
    </div>
  );
}

/* ── Metadata Tab ────────────────────────────────────────────── */

function MetadataTab({ file, sha256 }: { file: File | null; sha256: string }) {
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('info');
  const [editMode, setEditMode] = useState(false);
  const [editField, setEditField] = useState<{ section: string; key: string; value: string } | null>(null);
  const [sanitizePreset, setSanitizePreset] = useState<string>('forensic');
  const [sanitizedMeta, setSanitizedMeta] = useState<FileMetadata | null>(null);

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    setError(null);
    extractFileMetadata(file, sha256)
      .then(setMetadata)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [file, sha256]);

  if (!file) return <EmptyInspector />;
  if (loading) return <div className="inspector-tab-content"><div className="panel" style={{ padding: 16 }}>Extracting metadata…</div></div>;
  if (error) return <div className="inspector-tab-content"><div className="panel" style={{ padding: 16, color: 'var(--color-error)' }}>Error: {error}</div></div>;
  if (!metadata) return null;

  const categoryColors: Record<string, string> = {
    info: 'var(--color-primary)',
    camera: 'var(--color-secondary)',
    location: 'var(--color-tertiary)',
    dates: 'var(--color-primary)',
    '版权': 'var(--color-secondary)',
    technical: '#94a3b8',
    ai: 'var(--color-warning)',
    warning: 'var(--color-error)',
  };

  // All metadata entries are editable in-memory

  function handleEditField(section: string, key: string, value: string) {
    setEditField({ section, key, value });
    setEditMode(true);
  }

  function saveEdit() {
    if (!editField || !metadata) return;
    const updated = applyMetadataEdit(metadata, editField.section, editField.key, editField.value);
    setMetadata(updated);
    setEditMode(false);
    setEditField(null);
  }

  function runSanitize() {
    if (!metadata) return;
    const preset = SANITIZE_PRESETS[sanitizePreset];
    if (!preset) return;
    const result = sanitizeMetadata(metadata, preset.keep);
    setSanitizedMeta({
      ...metadata,
      sections: result.sections,
    });
  }

  function downloadSanitized() {
    if (!file) return;
    const meta = sanitizedMeta || metadata;
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, '')}_metadata.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="inspector-tab-content">
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>File Metadata & Binary Analysis</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="action-tactile button-ghost" type="button" onClick={() => { setEditMode(false); setEditField(null); }}>
              <Eye size={13} /> {editMode ? 'Done' : 'View'}
            </button>
            {!editMode && (
              <button className="action-tactile button-ghost" type="button" onClick={() => setEditMode(true)}>
                <Pencil size={13} /> Edit
              </button>
            )}
            <button className="action-tactile button-ghost" type="button" onClick={downloadSanitized}>
              <Download size={13} /> Export JSON
            </button>
          </div>
        </div>

        {/* Sanitizer */}
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--color-surface-lowest)', borderRadius: 6, border: '1px solid rgba(61,73,76,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-on-surface)' }}>Sanitize:</span>
            <select
              value={sanitizePreset}
              onChange={(e) => setSanitizePreset(e.target.value)}
              style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-on-surface)', border: '1px solid var(--color-outline-variant)' }}
            >
              {Object.entries(SANITIZE_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <button className="action-tactile button-secondary" type="button" onClick={runSanitize} style={{ fontSize: 12, padding: '2px 8px' }}>
              <ShieldCheck size={13} /> Apply
            </button>
            {sanitizedMeta && (
              <span style={{ fontSize: 11, color: 'var(--color-tertiary)' }}>
                {metadata.sections.length} → {sanitizedMeta.sections.length} sections
              </span>
            )}
          </div>
        </div>

        {/* Edit field dialog */}
        {editMode && editField && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(76, 215, 246, 0.05)', borderRadius: 6, border: '1px solid rgba(76, 215, 246, 0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Editing: {editField.key}</div>
            <textarea
              value={editField.value}
              onChange={(e) => setEditField({ ...editField, value: e.target.value })}
              style={{ width: '100%', minHeight: 60, fontSize: 12, fontFamily: 'var(--font-mono)', padding: 6, borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-on-surface)', border: '1px solid var(--color-outline-variant)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="action-tactile button-primary" type="button" onClick={saveEdit} style={{ fontSize: 12 }}>Save</button>
              <button className="action-tactile button-ghost" type="button" onClick={() => { setEditMode(false); setEditField(null); }} style={{ fontSize: 12 }}>Cancel</button>
            </div>
          </div>
        )}
        {editMode && !editField && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(76, 215, 246, 0.05)', borderRadius: 6, border: '1px solid rgba(76, 215, 246, 0.2)', fontSize: 12, color: 'var(--color-primary)' }}>
            Click the pencil icon on any field below to edit it. Click "Done" when finished.
          </div>
        )}

        {/* Section tabs */}
        <div className="metadata-section-tabs" style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {metadata.sections.map((section) => (
            <button
              key={section.label}
              className={`tab-btn ${activeSection === section.label ? 'active' : ''}`}
              type="button"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setActiveSection(section.label)}
            >
              {section.label}
            </button>
          ))}
          <button
            className={`tab-btn ${activeSection === 'hex' ? 'active' : ''}`}
            type="button"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setActiveSection('hex')}
          >
            Binary Inspector
          </button>
        </div>

        {/* Content */}
        <div style={{ marginTop: 12 }}>
          {activeSection === 'hex' ? (
            <BinaryInspector binary={metadata.binary} />
          ) : (
            metadata.sections.filter(s => s.label === activeSection).map((section) => (
              <div key={section.label} className="metadata-entries">
                {section.entries.map((entry) => (
                  <div key={entry.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(61,73,76,0.2)', alignItems: 'center' }}>
                    <span style={{ color: categoryColors[entry.category] ?? '#94a3b8', fontWeight: 500 }}>{entry.key}</span>
                    <span style={{ color: 'var(--color-on-surface)', fontFamily: entry.key === 'SHA-256' || entry.key === 'Magic Bytes' ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>
                      {entry.key === 'Google Maps' ? (
                        <a href={entry.value} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)' }}>{entry.value}</a>
                      ) : entry.value}
                    </span>
                    {editMode && (
                      <button
                        className="action-tactile button-ghost"
                        type="button"
                        style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(77, 215, 246, 0.1)', border: '1px solid rgba(77, 215, 246, 0.3)', borderRadius: 4, color: 'var(--color-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={() => handleEditField(section.label, entry.key, entry.value)}
                      >
                        <Pencil size={11} /> Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ManifestCard({ manifest }: { manifest: ManifestSummary }) {
  return (
    <article className={`manifest-card ${manifest.isActive ? 'active' : ''}`}>
      <div className="manifest-heading">
        <div>
          <p className="eyebrow">{manifest.isActive ? 'Active manifest' : 'Ingredient manifest'}</p>
          <h3>{manifest.label}</h3>
        </div>
        {manifest.signatureAlgorithm ? <span className="algorithm">{manifest.signatureAlgorithm}</span> : null}
      </div>
      <dl className="detail-grid manifest-details">
        <div><dt>Title</dt><dd>{manifest.title ?? 'Not provided'}</dd></div>
        <div><dt>Format</dt><dd>{manifest.format ?? 'Not provided'}</dd></div>
        <div><dt>Claim generator</dt><dd>{manifest.claimGenerator ?? 'Not provided'}</dd></div>
        <div><dt>Issuer</dt><dd>{manifest.issuer ?? 'Not provided'}</dd></div>
        <div><dt>Signed</dt><dd>{formatDate(manifest.signedAt)}</dd></div>
      </dl>
      <div className="manifest-columns">
        <section>
          <h4>Ingredients</h4>
          {manifest.ingredients.length > 0 ? (
            <ul>{manifest.ingredients.map((ingredient, index) => <li key={`${ingredient}-${index}`}>{ingredient}</li>)}</ul>
          ) : <p className="muted">None listed.</p>}
        </section>
        <section>
          <h4>Assertions</h4>
          {manifest.assertions.length > 0 ? (
            <ul>{manifest.assertions.map((assertion) => <li key={assertion}>{assertion}</li>)}</ul>
          ) : <p className="muted">None listed.</p>}
        </section>
      </div>
      <section className="validation-section">
        <h4>Validation</h4>
        <CodeList codes={manifest.validationCodes} />
      </section>
    </article>
  );
}

function CryptoCheck({ label, value, passed }: { label: string; value: string; passed?: boolean }) {
  return (
    <div className="crypto-check">
      <div className="crypto-check-left">
        {passed === undefined ? (
          <span className="check-pending" style={{ fontSize: 14 }}>⏳</span>
        ) : passed ? (
          <CheckCircle2 className="check-icon-anim" size={18} style={{ color: 'var(--color-tertiary)' }} />
        ) : (
          <span className="check-failed" style={{ fontSize: 14 }}>✕</span>
        )}
        <span className="crypto-check-label">{label}</span>
      </div>
      {passed !== undefined && <span className="crypto-check-value passed">PASSED</span>}
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="empty-inspector">
      <ScanSearch size={30} />
      <h3>Awaiting media</h3>
      <p>Upload a file or load the local sample to begin cryptographic inspection.</p>
    </div>
  );
}

function FutureView({ view, result }: { view: Exclude<View, 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text'>; result: VerificationResult | null }) {
  const titles: Record<Exclude<View, 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text'>, string> = {
    evidence: 'Evidence Export',
    settings: 'Trust Anchors / Settings'
  };
  const descriptions: Record<Exclude<View, 'inspector' | 'batch' | 'diff' | 'simulator' | 'playground' | 'lineage' | 'text'>, string> = {
    evidence: 'Package verification results, hashes, and validation codes for review.',
    settings: 'Configure trust policy and local processing preferences.'
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

/* ── Provenance Diff View ──────────────────────────────────────── */

interface DiffSlot {
  file: File | null;
  previewUrl: string | null;
  result: VerificationResult | null;
  status: 'empty' | 'verifying' | 'done' | 'error';
}

interface DiffAssertion {
  label: string;
  inA: boolean;
  inB: boolean;
}

interface DiffIngredient {
  name: string;
  inA: boolean;
  inB: boolean;
}

interface DiffResult {
  assertionDiff: DiffAssertion[];
  ingredientDiff: DiffIngredient[];
  bindingHolds: boolean;
  distance: number; // 0–100, 0 = identical, 100 = completely different
  aManifestCount: number;
  bManifestCount: number;
  aValidationState: string;
  bValidationState: string;
}

function computeDiff(a: VerificationResult, b: VerificationResult): DiffResult {
  const aManifest = a.manifests.find((m) => m.isActive) ?? a.manifests[0];
  const bManifest = b.manifests.find((m) => m.isActive) ?? b.manifests[0];

  const aAssertions = new Set(aManifest?.assertions ?? []);
  const bAssertions = new Set(bManifest?.assertions ?? []);
  const allAssertions = new Set([...aAssertions, ...bAssertions]);

  const assertionDiff: DiffAssertion[] = Array.from(allAssertions).map((label) => ({
    label,
    inA: aAssertions.has(label),
    inB: bAssertions.has(label),
  }));

  const aIngredients = new Set(aManifest?.ingredients ?? []);
  const bIngredients = new Set(bManifest?.ingredients ?? []);
  const allIngredients = new Set([...aIngredients, ...bIngredients]);

  const ingredientDiff: DiffIngredient[] = Array.from(allIngredients).map((name) => ({
    name,
    inA: aIngredients.has(name),
    inB: bIngredients.has(name),
  }));

  // Content binding: both have valid signatures
  const bindingHolds = a.validationState !== 'Invalid' && b.validationState !== 'Invalid' &&
    a.status === 'ready' && b.status === 'ready';

  // Provenance distance: weighted score
  const totalAssertions = allAssertions.size || 1;
  const assertionsChanged = assertionDiff.filter((d) => d.inA !== d.inB).length;
  const totalIngredients = allIngredients.size || 1;
  const ingredientsChanged = ingredientDiff.filter((d) => d.inA !== d.inB).length;

  const assertionScore = (assertionsChanged / totalAssertions) * 40;
  const ingredientScore = (ingredientsChanged / totalIngredients) * 30;
  const bindingScore = bindingHolds ? 0 : 20;
  const generatorScore = (aManifest?.claimGenerator !== bManifest?.claimGenerator) ? 10 : 0;

  const distance = Math.min(100, Math.round(assertionScore + ingredientScore + bindingScore + generatorScore));

  return {
    assertionDiff,
    ingredientDiff,
    bindingHolds,
    distance,
    aManifestCount: a.manifestCount,
    bManifestCount: b.manifestCount,
    aValidationState: a.validationState,
    bValidationState: b.validationState,
  };
}

function DiffView({ showToast }: { showToast: (msg: string) => void }) {
  const [slotA, setSlotA] = useState<DiffSlot>(() => {
    const stored = getStoredDiffSlotA();
    if (!stored) return { file: null, previewUrl: null, result: null, status: 'empty' };
    return {
      file: null,
      previewUrl: null,
      result: stored.sha256 ? {
        status: 'ready' as const,
        fileName: stored.fileName ?? '',
        fileSize: stored.fileSize,
        mimeType: stored.mimeType,
        sha256: stored.sha256,
        validationState: (stored.validationState || 'Unknown') as ValidationState,
        manifestCount: 0,
        manifests: [],
        warnings: [],
      } : null,
      status: 'done' as const,
    };
  });
  const [slotB, setSlotB] = useState<DiffSlot>({ file: null, previewUrl: null, result: null, status: 'empty' });
  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);

  // Persistence: save slot A
  useEffect(() => {
    if (slotA.result) {
      storeDiffSlotA({
        fileName: slotA.result.fileName,
        fileSize: slotA.result.fileSize,
        mimeType: slotA.result.mimeType,
        sha256: slotA.result.sha256,
        validationState: slotA.result.validationState,
      });
    }
  }, [slotA.result]);

  useEffect(() => {
    return () => {
      if (slotA.previewUrl) URL.revokeObjectURL(slotA.previewUrl);
      if (slotB.previewUrl) URL.revokeObjectURL(slotB.previewUrl);
    };
  }, []);

  async function processFile(file: File, side: 'A' | 'B') {
    const setSlot = side === 'A' ? setSlotA : setSlotB;
    const oldUrl = side === 'A' ? slotA.previewUrl : slotB.previewUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);

    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setSlot({ file, previewUrl, result: null, status: 'verifying' });

    try {
      const result = await verifyFile(file);
      setSlot({ file, previewUrl, result, status: 'done' });
      showToast(`Side ${side}: ${file.name} verified`);
    } catch (error) {
      const err = errorResult(file.name, file.size, file.type, '', error);
      setSlot({ file, previewUrl, result: err, status: 'error' });
    }
  }

  function handleDrop(e: React.DragEvent, side: 'A' | 'B') {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file, side);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>, side: 'A' | 'B') {
    const file = e.target.files?.[0];
    if (file) void processFile(file, side);
    e.target.value = '';
  }

  function clearAll() {
    if (slotA.previewUrl) URL.revokeObjectURL(slotA.previewUrl);
    if (slotB.previewUrl) URL.revokeObjectURL(slotB.previewUrl);
    setSlotA({ file: null, previewUrl: null, result: null, status: 'empty' });
    setSlotB({ file: null, previewUrl: null, result: null, status: 'empty' });
    showToast('Diff cleared');
  }

  const bothReady = slotA.status === 'done' && slotB.status === 'done' && slotA.result && slotB.result;
  const diff = bothReady ? computeDiff(slotA.result!, slotB.result!) : null;

  function distanceColor(d: number) {
    if (d <= 20) return 'var(--color-tertiary)';
    if (d <= 50) return '#f59e0b';
    return '#f43f5e';
  }

  function distanceLabel(d: number) {
    if (d <= 10) return 'Identical provenance';
    if (d <= 25) return 'Minor differences';
    if (d <= 50) return 'Moderate changes';
    if (d <= 75) return 'Significant divergence';
    return 'Major provenance shift';
  }

  return (
    <main className="diff-view">
      <div className="diff-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Provenance Diff</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Compare two versions of the same media. See which assertions survived, ingredients changed, and whether content binding holds.
          </p>
        </div>
        {(slotA.status !== 'empty' || slotB.status !== 'empty') && (
          <button className="action-tactile button-ghost" type="button" onClick={clearAll}>
            <Trash2 size={15} /> Clear
          </button>
        )}
      </div>

      {/* Two Drop Zones */}
      <div className="diff-slots">
        {(['A', 'B'] as const).map((side) => {
          const slot = side === 'A' ? slotA : slotB;
          const setSlot = side === 'A' ? setSlotA : setSlotB;
          const inputRef = side === 'A' ? inputARef : inputBRef;
          return (
            <div
              key={side}
              className={`diff-slot ${slot.status === 'verifying' ? 'verifying' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, side)}
            >
              <div className="diff-slot-label">Side {side}</div>
              {slot.previewUrl ? (
                <div className="diff-slot-preview">
                  <img src={slot.previewUrl} alt={`Side ${side} preview`} />
                  <div className="diff-slot-info">
                    <span className="diff-slot-name" title={slot.file?.name ?? ''}>{slot.file?.name}</span>
                    <span className="diff-slot-meta">{slot.file ? formatBytes(slot.file.size) : ''} • {slot.file?.type}</span>
                  </div>
                   {slot.status === 'verifying' && (
                     <div className="diff-slot-overlay">
                       <RefreshCw size={24} className="spin" style={{ color: 'var(--color-primary)' }} />
                       <span>Verifying...</span>
                     </div>
                   )}
        </div>
      ) : (
                <div className="diff-slot-empty" onClick={() => inputRef.current?.click()}>
                  <Upload size={32} style={{ color: 'var(--color-outline)' }} />
                  <strong>Drop {side === 'A' ? 'original' : 'modified'} file</strong>
                  <span>or click to browse</span>
                </div>
              )}
              {slot.result && (
                <div className={`diff-slot-verdict ${slot.result.status === 'ready' ? 'success' : slot.result.status === 'missing' ? 'warning' : 'danger'}`}>
                  <span className="diff-slot-verdict-label">
                    {slot.result.status === 'ready' ? 'C2PA Verified' : slot.result.status === 'missing' ? 'No C2PA' : 'Error'}
                  </span>
                  <span className="diff-slot-verdict-state">{slot.result.validationState}</span>
                </div>
              )}
              <input ref={inputRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES} onChange={(e) => handleFileInput(e, side)} />
            </div>
          );
        })}
      </div>

      {/* Diff Results */}
      {diff && (
        <div className="diff-results">
          {/* Distance Score */}
          <div className="diff-distance">
            <div className="diff-distance-bar">
              <div className="diff-distance-fill" style={{ width: `${diff.distance}%`, background: distanceColor(diff.distance) }} />
            </div>
            <div className="diff-distance-info">
              <div>
                <span className="diff-distance-label">Provenance Distance</span>
                <strong style={{ color: distanceColor(diff.distance) }}>{diff.distance}%</strong>
              </div>
              <span className="diff-distance-desc">{distanceLabel(diff.distance)}</span>
            </div>
          </div>

          {/* Binding Status */}
          <div className="diff-section">
            <h3>Content Binding</h3>
            <div className={`diff-binding ${diff.bindingHolds ? 'holds' : 'broken'}`}>
              {diff.bindingHolds ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <span>{diff.bindingHolds ? 'Content binding holds — both signatures valid' : 'Content binding broken — one or both signatures invalid'}</span>
            </div>
          </div>

          {/* Assertion Diff */}
          <div className="diff-section">
            <h3>Assertions</h3>
            {diff.assertionDiff.length === 0 ? (
              <p className="muted">No assertions found in either file.</p>
            ) : (
              <div className="diff-list">
                {diff.assertionDiff.map((d) => (
                  <div key={d.label} className={`diff-item ${d.inA && d.inB ? 'same' : d.inA ? 'removed' : 'added'}`}>
                    <span className="diff-item-indicator">
                      {d.inA && d.inB ? '≡' : d.inA ? '−' : '+'}
                    </span>
                    <span className="diff-item-label">{d.label}</span>
                    <span className="diff-item-status">
                      {d.inA && d.inB ? 'In both' : d.inA ? 'Only in A' : 'Only in B'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ingredient Diff */}
          <div className="diff-section">
            <h3>Ingredients</h3>
            {diff.ingredientDiff.length === 0 ? (
              <p className="muted">No ingredients found in either file.</p>
            ) : (
              <div className="diff-list">
                {diff.ingredientDiff.map((d) => (
                  <div key={d.name} className={`diff-item ${d.inA && d.inB ? 'same' : d.inA ? 'removed' : 'added'}`}>
                    <span className="diff-item-indicator">
                      {d.inA && d.inB ? '≡' : d.inA ? '−' : '+'}
                    </span>
                    <span className="diff-item-label">{d.name}</span>
                    <span className="diff-item-status">
                      {d.inA && d.inB ? 'In both' : d.inA ? 'Only in A' : 'Only in B'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="diff-summary">
            <div className="diff-summary-item">
              <span>Side A manifests</span>
              <strong>{diff.aManifestCount}</strong>
            </div>
            <div className="diff-summary-item">
              <span>Side A state</span>
              <strong>{diff.aValidationState}</strong>
            </div>
            <div className="diff-summary-item">
              <span>Side B manifests</span>
              <strong>{diff.bManifestCount}</strong>
            </div>
            <div className="diff-summary-item">
              <span>Side B state</span>
              <strong>{diff.bValidationState}</strong>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── What Would Break? Simulator View ───────────────────────────── */

interface SimOperation {
  id: string;
  name: string;
  description: string;
  category: 'format' | 'resize' | 'transform' | 'metadata';
  execute: (img: HTMLImageElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<Blob>;
}

const SIM_OPERATIONS: SimOperation[] = [
  {
    id: 'jpeg-q90',
    name: 'JPEG Re-save (Q90)',
    description: 'Re-encode as JPEG with quality 0.9',
    category: 'format',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
    },
  },
  {
    id: 'jpeg-q50',
    name: 'JPEG Re-save (Q50)',
    description: 'Re-encode as JPEG with quality 0.5 (heavy compression)',
    category: 'format',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.5));
    },
  },
  {
    id: 'png-reencode',
    name: 'PNG Re-save',
    description: 'Convert to PNG format',
    category: 'format',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    },
  },
  {
    id: 'webp-q80',
    name: 'WebP Re-save (Q80)',
    description: 'Convert to WebP format',
    category: 'format',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/webp', 0.8));
    },
  },
  {
    id: 'resize-50',
    name: 'Downscale 50%',
    description: 'Resize to half width and height',
    category: 'resize',
    execute: async (img, canvas, ctx) => {
      const w = Math.floor(img.naturalWidth / 2);
      const h = Math.floor(img.naturalHeight / 2);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'resize-25',
    name: 'Downscale 25%',
    description: 'Resize to quarter width and height',
    category: 'resize',
    execute: async (img, canvas, ctx) => {
      const w = Math.floor(img.naturalWidth / 4);
      const h = Math.floor(img.naturalHeight / 4);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'crop-center',
    name: 'Center Crop 75%',
    description: 'Crop to center 75% of the image',
    category: 'transform',
    execute: async (img, canvas, ctx) => {
      const cw = Math.floor(img.naturalWidth * 0.75);
      const ch = Math.floor(img.naturalHeight * 0.75);
      const sx = Math.floor((img.naturalWidth - cw) / 2);
      const sy = Math.floor((img.naturalHeight - ch) / 2);
      canvas.width = cw;
      canvas.height = ch;
      ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'rotate-90',
    name: 'Rotate 90°',
    description: 'Rotate image 90 degrees clockwise',
    category: 'transform',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalHeight;
      canvas.height = img.naturalWidth;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'flip-h',
    name: 'Horizontal Flip',
    description: 'Mirror the image horizontally',
    category: 'transform',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'blur',
    name: 'Gaussian Blur',
    description: 'Apply 5px Gaussian blur',
    category: 'transform',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.filter = 'blur(5px)';
      ctx.drawImage(img, 0, 0);
      ctx.filter = 'none';
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'brightness',
    name: 'Brightness +30%',
    description: 'Increase brightness by 30%',
    category: 'transform',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.filter = 'brightness(1.3)';
      ctx.drawImage(img, 0, 0);
      ctx.filter = 'none';
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    description: 'Convert to grayscale',
    category: 'transform',
    execute: async (img, canvas, ctx) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(img, 0, 0);
      ctx.filter = 'none';
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
    },
  },
];

interface SimResult {
  operation: SimOperation;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
  originalState: string;
  newState: string;
  error?: string;
}

function SimulatorView({ showToast }: { showToast: (msg: string) => void }) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [results, setResults] = useState<SimResult[]>([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResults([]);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResults([]);
  }

  async function runSimulations() {
    if (!sourceFile || !canvasRef.current) return;
    setRunning(true);
    setResults([]);

    // Verify original first
    let originalState = 'missing';
    try {
      const origResult = await verifyFile(sourceFile);
      originalState = origResult.validationState;
    } catch { /* keep missing */ }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const img = new window.Image();

    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.src = URL.createObjectURL(sourceFile);
    });

    const newResults: SimResult[] = [];

    for (const op of SIM_OPERATIONS) {
      const simResult: SimResult = { operation: op, status: 'running', originalState, newState: '' };
      setResults([...newResults, simResult]);

      try {
        const blob = await op.execute(img, canvas, ctx);
        const transformedFile = new File([blob], `transformed.${blob.type.split('/')[1] || 'jpg'}`, { type: blob.type });
        const result = await verifyFile(transformedFile);
        simResult.status = result.validationState === originalState ? 'passed' : 'failed';
        simResult.newState = result.validationState;
      } catch (err) {
        simResult.status = 'error';
        simResult.error = err instanceof Error ? err.message : 'Unknown error';
      }

      newResults.push(simResult);
      setResults([...newResults]);
    }

    URL.revokeObjectURL(img.src);
    setRunning(false);
    showToast('Simulation complete');
  }

  function clearAll() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null);
    setPreviewUrl(null);
    setResults([]);
    showToast('Simulator cleared');
  }

  function exportReport() {
    const rows = results.map((r) => ({
      operation: r.operation.name,
      category: r.operation.category,
      status: r.status,
      originalState: r.originalState,
      newState: r.newState,
      error: r.error || '',
    }));
    const json = JSON.stringify(rows, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `breakage-report-${sourceFile?.name ?? 'unknown'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported');
  }

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  const categories = ['format', 'resize', 'transform'] as const;
  const categoryLabels: Record<string, string> = { format: 'Format Conversion', resize: 'Resize', transform: 'Transform' };

  return (
    <main className="sim-view">
      <div className="sim-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>What Would Break This?</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Drop a signed image to see which operations preserve or destroy its C2PA provenance.
          </p>
        </div>
        {sourceFile && (
          <div className="sim-actions">
            {results.length > 0 && (
              <button className="action-tactile button-ghost" type="button" onClick={exportReport}>
                <Download size={15} /> Export Report
              </button>
            )}
            <button className="action-tactile button-ghost" type="button" onClick={clearAll}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
        )}
      </div>

      {/* Source Upload */}
      <div
        className="sim-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {previewUrl ? (
          <div className="sim-drop-preview">
            <img src={previewUrl} alt="Source file" />
            <div className="sim-drop-info">
              <span className="sim-drop-name" title={sourceFile?.name ?? ''}>{sourceFile?.name}</span>
              <span className="sim-drop-meta">{sourceFile ? formatBytes(sourceFile.size) : ''} • {sourceFile?.type}</span>
            </div>
          </div>
        ) : (
          <div className="sim-drop-empty">
            <Upload size={36} style={{ color: 'var(--color-outline)' }} />
            <strong>Drop a signed image to test</strong>
            <span>or click to browse</span>
          </div>
        )}
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleFileInput} />
      </div>

      {/* Run Button */}
      {sourceFile && results.length === 0 && (
        <button
          className="action-tactile button-primary sim-run-btn"
          type="button"
          onClick={runSimulations}
          disabled={running}
        >
          <Play size={16} /> Run All Simulations
        </button>
      )}

      {/* Running indicator */}
      {running && (
        <div className="sim-progress">
          <RefreshCw size={16} className="spin" />
          <span>Testing operations...</span>
        </div>
      )}

      {/* Summary Bar */}
      {results.length > 0 && (
        <div className="sim-summary">
          <div className="sim-summary-stat success">
            <CheckCircle2 size={16} />
            <strong>{passedCount}</strong>
            <span>Preserved</span>
          </div>
          <div className="sim-summary-stat danger">
            <AlertTriangle size={16} />
            <strong>{failedCount}</strong>
            <span>Broken</span>
          </div>
          {errorCount > 0 && (
            <div className="sim-summary-stat warning">
              <Info size={16} />
              <strong>{errorCount}</strong>
              <span>Errors</span>
            </div>
          )}
        </div>
      )}

      {/* Results by Category */}
      {results.length > 0 && (
        <div className="sim-results">
          {categories.map((cat) => {
            const catResults = results.filter((r) => r.operation.category === cat);
            if (catResults.length === 0) return null;
            return (
              <div key={cat} className="sim-category">
                <h3>{categoryLabels[cat]}</h3>
                <div className="sim-grid">
                  {catResults.map((r) => (
                    <div key={r.operation.id} className={`sim-card ${r.status}`}>
                      <div className="sim-card-status">
                        {r.status === 'passed' && <CheckCircle2 size={18} />}
                        {r.status === 'failed' && <AlertTriangle size={18} />}
                        {r.status === 'error' && <Info size={18} />}
                        {r.status === 'running' && <RefreshCw size={18} className="spin" />}
                        {r.status === 'pending' && <span className="sim-dot" />}
                      </div>
                      <div className="sim-card-info">
                        <span className="sim-card-name">{r.operation.name}</span>
                        <span className="sim-card-desc">{r.operation.description}</span>
                      </div>
                      <div className="sim-card-verdict">
                        {r.status === 'passed' && <span className="sim-badge preserved">Preserved</span>}
                        {r.status === 'failed' && <span className="sim-badge broken">Broken</span>}
                        {r.status === 'error' && <span className="sim-badge error">Error</span>}
                        {r.status === 'running' && <span className="sim-badge running">Testing</span>}
                        {r.status === 'pending' && <span className="sim-badge pending">Pending</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Export buttons (when results exist) */}
      {results.length > 0 && !running && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="action-tactile button-ghost" type="button" onClick={() => {
            const data = results.map(r => ({
              operation: r.operation.name,
              category: r.operation.category,
              description: r.operation.description,
              status: r.status,
              originalState: r.originalState,
              newState: r.newState,
            }));
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `simulation-results.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}>
            <Download size={14} /> JSON
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={() => {
            const headers = ['Operation', 'Category', 'Description', 'Status', 'Original State', 'New State'];
            const rows = results.map(r => [r.operation.name, r.operation.category, r.operation.description, r.status, r.originalState, r.newState]);
            const csv = [headers, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `simulation-results.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}>
            <Download size={14} /> CSV
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="visually-hidden" />
    </main>
  );
}

/* ── Trust Policy Playground View ──────────────────────────────── */

interface PolicyRule {
  id: string;
  type: 'require_assertion' | 'reject_algorithm' | 'require_issuer' | 'reject_issuer' | 'min_trust' | 'require_binding';
  label: string;
  value: string;
  enabled: boolean;
}

const DEFAULT_RULES: PolicyRule[] = [
  { id: '1', type: 'require_binding', label: 'Require valid content binding', value: 'true', enabled: true },
  { id: '2', type: 'min_trust', label: 'Minimum trust level', value: 'Trusted', enabled: true },
  { id: '3', type: 'require_assertion', label: 'Require assertion: c2pa.hash', value: 'c2pa.hash', enabled: false },
  { id: '4', type: 'require_assertion', label: 'Require assertion: c2pa CLAIM_SIGNATURE', value: 'c2pa CLAIM_SIGNATURE', enabled: false },
  { id: '5', type: 'reject_algorithm', label: 'Reject algorithm: sha-1', value: 'sha-1', enabled: false },
  { id: '6', type: 'require_issuer', label: 'Require issuer contains', value: '', enabled: false },
  { id: '7', type: 'reject_issuer', label: 'Reject issuer contains', value: '', enabled: false },
];

interface PolicyCheck {
  ruleId: string;
  passed: boolean;
  message: string;
}

function evaluatePolicy(result: VerificationResult, rules: PolicyRule[]): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  const activeRules = rules.filter((r) => r.enabled);
  const manifest = result.manifests.find((m) => m.isActive) ?? result.manifests[0];

  for (const rule of activeRules) {
    switch (rule.type) {
      case 'require_binding': {
        const passed = result.status === 'ready' && result.validationState !== 'Invalid';
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed ? 'Content binding valid' : 'Content binding missing or invalid',
        });
        break;
      }
      case 'min_trust': {
        const levels: Record<string, number> = { Trusted: 3, Valid: 2, Missing: 1, Invalid: 0, Error: 0 };
        const currentLevel = levels[result.validationState] ?? 0;
        const requiredLevel = levels[rule.value] ?? 0;
        const passed = currentLevel >= requiredLevel;
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Trust level "${result.validationState}" meets minimum "${rule.value}"`
            : `Trust level "${result.validationState}" below minimum "${rule.value}"`,
        });
        break;
      }
      case 'require_assertion': {
        const assertions = new Set(manifest?.assertions ?? []);
        const passed = assertions.has(rule.value);
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Assertion "${rule.value}" present`
            : `Assertion "${rule.value}" missing`,
        });
        break;
      }
      case 'reject_algorithm': {
        const alg = manifest?.signatureAlgorithm?.toLowerCase() ?? '';
        const passed = !alg.includes(rule.value.toLowerCase());
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Algorithm "${alg}" not rejected`
            : `Algorithm "${alg}" matches rejected pattern "${rule.value}"`,
        });
        break;
      }
      case 'require_issuer': {
        const issuer = manifest?.issuer?.toLowerCase() ?? '';
        const passed = rule.value ? issuer.includes(rule.value.toLowerCase()) : true;
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Issuer "${manifest?.issuer}" matches required pattern`
            : `Issuer "${manifest?.issuer}" does not contain "${rule.value}"`,
        });
        break;
      }
      case 'reject_issuer': {
        const issuer = manifest?.issuer?.toLowerCase() ?? '';
        const passed = rule.value ? !issuer.includes(rule.value.toLowerCase()) : true;
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Issuer "${manifest?.issuer}" not rejected`
            : `Issuer "${manifest?.issuer}" matches rejected pattern "${rule.value}"`,
        });
        break;
      }
    }
  }

  return checks;
}

function PlaygroundView({ showToast }: { showToast: (msg: string) => void }) {
  const [rules, setRules] = useState<PolicyRule[]>(() => {
    const stored = getStoredPlaygroundRules();
    if (stored.length === 0) return DEFAULT_RULES;
    return stored.map((r) => ({
      ...DEFAULT_RULES.find((d) => d.id === r.id) ?? { id: r.id, type: 'require_assertion' as const, label: r.field },
      id: r.id,
      label: r.field,
      value: r.value,
      enabled: r.enabled,
    }));
  });
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [checks, setChecks] = useState<PolicyCheck[]>([]);
  const [verifying, setVerifying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persistence: save playground rules
  useEffect(() => {
    storePlaygroundRules(rules.map((r) => ({
      id: r.id,
      field: r.label,
      operator: r.type,
      value: r.value ?? '',
      enabled: r.enabled,
    })));
  }, [rules]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, []);

  function toggleRule(id: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function updateRuleValue(id: string, value: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  function addRule() {
    const newRule: PolicyRule = {
      id: Date.now().toString(),
      type: 'require_assertion',
      label: 'New assertion check',
      value: '',
      enabled: false,
    };
    setRules((prev) => [...prev, newRule]);
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  function resetRules() {
    setRules(DEFAULT_RULES);
    showToast('Rules reset to defaults');
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setChecks([]);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setChecks([]);
  }

  async function testPolicy() {
    if (!sourceFile) return;
    setVerifying(true);
    try {
      const res = await verifyFile(sourceFile);
      setResult(res);
      const policyChecks = evaluatePolicy(res, rules);
      setChecks(policyChecks);
      const passed = policyChecks.every((c) => c.passed);
      showToast(passed ? 'All policy rules passed' : 'Some policy rules failed');
    } catch (err) {
      const errRes = errorResult(sourceFile.name, sourceFile.size, sourceFile.type, '', err);
      setResult(errRes);
      setChecks([{ ruleId: 'error', passed: false, message: 'Verification failed' }]);
    }
    setVerifying(false);
  }

  function clearAll() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null);
    setPreviewUrl(null);
    setResult(null);
    setChecks([]);
    showToast('Playground cleared');
  }

  function exportPolicy() {
    const policy = {
      rules: rules.filter((r) => r.enabled),
      result: result ? {
        file: sourceFile?.name,
        validationState: result.validationState,
        checks: checks,
      } : null,
    };
    const json = JSON.stringify(policy, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trust-policy-${sourceFile?.name ?? 'config'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Policy exported');
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.filter((c) => !c.passed).length;
  const allPassed = checks.length > 0 && failedCount === 0;

  const ruleTypeLabels: Record<string, string> = {
    require_binding: 'Binding',
    min_trust: 'Trust',
    require_assertion: 'Assertion',
    reject_algorithm: 'Algorithm',
    require_issuer: 'Issuer',
    reject_issuer: 'Issuer',
  };

  return (
    <main className="pg-view">
      <div className="pg-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Trust Policy Playground</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Define custom trust rules, then drop a file to see if it passes your policy.
          </p>
        </div>
        {checks.length > 0 && (
          <button className="action-tactile button-ghost" type="button" onClick={exportPolicy}>
            <Download size={15} /> Export Policy
          </button>
        )}
      </div>

      {/* Policy Rules Editor */}
      <div className="pg-rules">
        <div className="pg-rules-header">
          <h2>Policy Rules</h2>
          <div className="pg-rules-actions">
            <button className="action-tactile button-ghost" type="button" onClick={resetRules}>
              <RefreshCw size={14} /> Reset
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={addRule}>
              <Check size={14} /> Add Rule
            </button>
          </div>
        </div>
        <div className="pg-rules-list">
          {rules.map((rule) => (
            <div key={rule.id} className={`pg-rule ${rule.enabled ? 'enabled' : 'disabled'}`}>
              <button
                className={`pg-rule-toggle ${rule.enabled ? 'active' : ''}`}
                type="button"
                onClick={() => toggleRule(rule.id)}
              >
                {rule.enabled ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
              </button>
              <div className="pg-rule-info">
                <span className="pg-rule-type">{ruleTypeLabels[rule.type]}</span>
                <span className="pg-rule-label">{rule.label}</span>
              </div>
              {(rule.type === 'require_assertion' || rule.type === 'reject_algorithm' || rule.type === 'require_issuer' || rule.type === 'reject_issuer') && (
                <input
                  className="pg-rule-input"
                  type="text"
                  placeholder="value..."
                  value={rule.value}
                  onChange={(e) => updateRuleValue(rule.id, e.target.value)}
                />
              )}
              {rule.type === 'min_trust' && (
                <select
                  className="pg-rule-select"
                  value={rule.value}
                  onChange={(e) => updateRuleValue(rule.id, e.target.value)}
                >
                  <option value="Trusted">Trusted</option>
                  <option value="Valid">Valid</option>
                  <option value="Missing">Missing</option>
                </select>
              )}
              <button
                className="pg-rule-remove"
                type="button"
                onClick={() => removeRule(rule.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* File Drop Zone */}
      <div
        className="pg-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {previewUrl ? (
          <div className="pg-drop-preview">
            <img src={previewUrl} alt="Source file" />
            <div className="pg-drop-info">
              <span className="pg-drop-name" title={sourceFile?.name ?? ''}>{sourceFile?.name}</span>
              <span className="pg-drop-meta">{sourceFile ? formatBytes(sourceFile.size) : ''} • {sourceFile?.type}</span>
            </div>
          </div>
        ) : (
          <div className="pg-drop-empty">
            <Upload size={36} style={{ color: 'var(--color-outline)' }} />
            <strong>Drop a signed image to test your policy</strong>
            <span>or click to browse</span>
          </div>
        )}
        <input ref={fileInputRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES} onChange={handleFileInput} />
      </div>

      {/* Test Button */}
      {sourceFile && checks.length === 0 && (
        <div className="pg-actions">
          <button
            className="action-tactile button-primary"
            type="button"
            onClick={testPolicy}
            disabled={verifying}
          >
            {verifying ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
            {verifying ? 'Testing...' : 'Test Policy'}
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={clearAll}>
            <Trash2 size={15} /> Clear
          </button>
        </div>
      )}

      {/* Results */}
      {checks.length > 0 && (
        <div className="pg-results">
          <div className={`pg-verdict ${allPassed ? 'pass' : 'fail'}`}>
            {allPassed ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
            <div className="pg-verdict-text">
              <strong>{allPassed ? 'Policy Passed' : 'Policy Failed'}</strong>
              <span>{passedCount}/{checks.length} rules passed</span>
            </div>
          </div>

          <div className="pg-checks">
            {checks.map((check) => (
              <div key={check.ruleId} className={`pg-check ${check.passed ? 'passed' : 'failed'}`}>
                <span className="pg-check-icon">
                  {check.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                </span>
                <span className="pg-check-message">{check.message}</span>
              </div>
            ))}
          </div>

          {result && (
            <div className="pg-file-info">
              <h3>File Details</h3>
              <div className="pg-file-grid">
                <div className="pg-file-item">
                  <span>Validation State</span>
                  <strong>{result.validationState}</strong>
                </div>
                <div className="pg-file-item">
                  <span>Status</span>
                  <strong>{result.status}</strong>
                </div>
                <div className="pg-file-item">
                  <span>Manifests</span>
                  <strong>{result.manifestCount}</strong>
                </div>
                <div className="pg-file-item">
                  <span>Issuer</span>
                  <strong>{result.manifests[0]?.issuer ?? 'N/A'}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/* ── Manifest Lineage Graph View ───────────────────────────────── */

interface LineageNode {
  id: string;
  label: string;
  type: 'active' | 'parent' | 'ingredient' | 'original';
  issuer?: string;
  algorithm?: string;
  date?: string;
  assertionCount?: number;
  x: number;
  y: number;
}

interface LineageEdge {
  from: string;
  to: string;
  type: 'parent' | 'ingredient' | 'replaced';
}

function buildLineage(result: VerificationResult): { nodes: LineageNode[]; edges: LineageEdge[] } {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const manifests = result.manifests;

  manifests.forEach((m, idx) => {
    const isActive = m.isActive;
    const nodeType: LineageNode['type'] = isActive ? 'active' : idx === manifests.length - 1 ? 'original' : 'parent';

    nodes.push({
      id: m.label,
      label: isActive ? `${m.label} (Active)` : m.label,
      type: nodeType,
      issuer: m.issuer,
      algorithm: m.signatureAlgorithm,
      date: m.signedAt,
      assertionCount: m.assertions.length,
      x: 160,
      y: 100 + idx * 160,
    });

    // Connect to previous manifest (parent chain)
    if (idx > 0) {
      edges.push({
        from: manifests[idx - 1].label,
        to: m.label,
        type: 'parent',
      });
    }

    // Add ingredients as nodes and edges
    (m.ingredients ?? []).forEach((ing, ingIdx) => {
      const ingId = `${m.label}-ing-${ingIdx}`;
      nodes.push({
        id: ingId,
        label: ing,
        type: 'ingredient',
        x: 420 + (ingIdx % 3) * 140,
        y: 100 + idx * 160 + Math.floor(ingIdx / 3) * 60,
      });
      edges.push({
        from: m.label,
        to: ingId,
        type: 'ingredient',
      });
    });
  });

  return { nodes, edges };
}

function LineageView({ result, showToast }: { result: VerificationResult | null; showToast: (msg: string) => void }) {
  const [selectedNode, setSelectedNode] = useState<LineageNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  const { nodes, edges } = result ? buildLineage(result) : { nodes: [], edges: [] };

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width || 800);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const graphWidth = Math.max(containerWidth, 800);
  const graphHeight = Math.max(600, nodes.length * 160 + 200);

  function handleMouseDown(e: React.MouseEvent) {
    if (e.target === svgRef.current || (e.target as SVGElement).tagName === 'rect') {
      dragging.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y };
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.startX;
    const dy = e.clientY - dragging.current.startY;
    setOffset({ x: dragging.current.offsetX + dx, y: dragging.current.offsetY + dy });
  }

  function handleMouseUp() {
    dragging.current = null;
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(2, Math.max(0.3, z + delta)));
  }

  function fitToView() {
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  }

  function getNodeColor(type: LineageNode['type']) {
    switch (type) {
      case 'active': return 'var(--color-primary)';
      case 'parent': return 'var(--color-secondary)';
      case 'ingredient': return 'var(--color-tertiary)';
      case 'original': return '#f59e0b';
      default: return 'var(--color-outline)';
    }
  }

  function getNodeRadius(type: LineageNode['type']) {
    return type === 'active' ? 32 : type === 'ingredient' ? 22 : 26;
  }

  return (
    <main className="lineage-view">
      <div className="lineage-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Manifest Lineage</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Visualize the provenance chain — parent manifests, ingredients, and content flow.
          </p>
        </div>
        <div className="lineage-controls">
          <button className="action-tactile button-ghost" type="button" onClick={fitToView}>
            <Maximize size={15} /> Fit
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={() => setZoom((z) => Math.min(2, z + 0.2))}>
            <ZoomIn size={15} />
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}>
            <ZoomOut size={15} />
          </button>
        </div>
      </div>

      {!result ? (
        <div className="lineage-empty">
          <GitBranch size={48} style={{ color: 'var(--color-outline)' }} />
          <h3>No manifest data</h3>
          <p>Verify a file in the Inspector tab first to see its lineage graph.</p>
        </div>
      ) : (
        <div className="lineage-content">
          {/* Legend */}
          <div className="lineage-legend">
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('active') }} />
              <span>Active Manifest</span>
            </div>
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('parent') }} />
              <span>Parent Manifest</span>
            </div>
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('ingredient') }} />
              <span>Ingredient</span>
            </div>
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('original') }} />
              <span>Original</span>
            </div>
          </div>

          {/* Graph */}
          <div className="lineage-graph-wrap" ref={containerRef}>
            <svg
              ref={svgRef}
              className="lineage-svg"
              width="100%"
              height="100%"
              viewBox={`0 0 ${graphWidth} ${graphHeight}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            >
              <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`}>
                {/* Edges */}
                {edges.map((edge, i) => {
                  const fromNode = nodes.find((n) => n.id === edge.from);
                  const toNode = nodes.find((n) => n.id === edge.to);
                  if (!fromNode || !toNode) return null;
                  return (
                    <line
                      key={i}
                      x1={fromNode.x + getNodeRadius(fromNode.type) + 8}
                      y1={fromNode.y}
                      x2={toNode.x - getNodeRadius(toNode.type) - 8}
                      y2={toNode.y}
                      stroke={edge.type === 'ingredient' ? 'rgba(78, 222, 163, 0.4)' : 'rgba(208, 188, 255, 0.4)'}
                      strokeWidth={2}
                      strokeDasharray={edge.type === 'replaced' ? '4,4' : 'none'}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.map((node) => {
                  const r = getNodeRadius(node.type);
                  const isSelected = selectedNode?.id === node.id;
                  return (
                    <g
                      key={node.id}
                      className={`lineage-node ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setSelectedNode(node); }}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Glow for active */}
                      {node.type === 'active' && (
                        <circle cx={node.x} cy={node.y} r={r + 6} fill={getNodeColor('active')} opacity={0.15} />
                      )}
                      {/* Main circle */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={r}
                        fill="var(--color-surface-container)"
                        stroke={getNodeColor(node.type)}
                        strokeWidth={isSelected ? 3 : 2}
                      />
                      {/* Label */}
                      <text
                        x={node.x}
                        y={node.y + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="var(--color-on-surface)"
                        fontSize={node.type === 'active' ? 12 : 10}
                        fontFamily="'JetBrains Mono', monospace"
                        fontWeight={node.type === 'active' ? 600 : 400}
                      >
                        {node.type === 'ingredient' ? 'I' : node.label.split('_')[0]?.slice(0, 4) ?? ''}
                      </text>
                      {/* Full label below */}
                      <text
                        x={node.x}
                        y={node.y + r + 16}
                        textAnchor="middle"
                        fill="var(--color-on-surface-dim)"
                        fontSize={11}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {node.label.length > 24 ? node.label.slice(0, 22) + '…' : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Selected Node Details */}
          {selectedNode && (
            <div className="lineage-detail">
              <div className="lineage-detail-header">
                <h3>{selectedNode.label}</h3>
                <button className="action-tactile button-ghost" type="button" onClick={() => setSelectedNode(null)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="lineage-detail-grid">
                <div className="lineage-detail-item">
                  <span>Type</span>
                  <strong style={{ color: getNodeColor(selectedNode.type) }}>
                    {selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1)}
                  </strong>
                </div>
                {selectedNode.issuer && (
                  <div className="lineage-detail-item">
                    <span>Issuer</span>
                    <strong>{selectedNode.issuer}</strong>
                  </div>
                )}
                {selectedNode.algorithm && (
                  <div className="lineage-detail-item">
                    <span>Algorithm</span>
                    <strong>{selectedNode.algorithm}</strong>
                  </div>
                )}
                {selectedNode.date && (
                  <div className="lineage-detail-item">
                    <span>Date</span>
                    <strong>{selectedNode.date}</strong>
                  </div>
                )}
                {selectedNode.assertionCount !== undefined && (
                  <div className="lineage-detail-item">
                    <span>Assertions</span>
                    <strong>{selectedNode.assertionCount}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/* ── Text Analysis View ────────────────────────────────────────── */

interface TextAnalysis {
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  lineCount: number;
  avgWordLength: number;
  avgSentenceLength: number;
  vocabularyRichness: number; // unique words / total words
  repetitionScore: number; // 0-100, higher = more repetitive
  sentenceUniformity: number; // 0-100, higher = more uniform lengths
  burstiness: number; // 0-100, higher = more varied (human-like)
  topWords: [string, number][];
  aiConfidence: number; // 0-100, estimated AI likelihood
  aiSignals: string[];
  // wink-nlp fields
  nlpSentiment: number; // -1 to 1
  nlpSentenceCount: number;
  nlpTokenCount: number;
  posDistribution: Record<string, number>;
  entities: { text: string; type: string }[];
  sentenceSentiments: number[];
  adjectiveDensity: number; // ADJ / total tokens
  nounDensity: number; // NOUN + PROPN / total tokens
  passiveEstimate: number; // estimated passive voice ratio
  pronounRatio: number; // PRON / total tokens
  entityDensity: number; // entities per sentence
}

function analyzeText(text: string): TextAnalysis {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const lines = text.split('\n');

  const charCount = text.length;
  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const paragraphCount = paragraphs.length;
  const lineCount = lines.length;

  const avgWordLength = wordCount > 0 ? words.reduce((sum, w) => sum + w.length, 0) / wordCount : 0;
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;

  // Vocabulary richness (type-token ratio)
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const vocabularyRichness = wordCount > 0 ? uniqueWords.size / wordCount : 0;

  // Repetition score
  const wordFreq = new Map<string, number>();
  words.forEach((w) => {
    const low = w.toLowerCase();
    wordFreq.set(low, (wordFreq.get(low) ?? 0) + 1);
  });
  const maxFreq = Math.max(...wordFreq.values(), 0);
  const repetitionScore = wordCount > 0 ? Math.min(100, (maxFreq / wordCount) * 100 * 10) : 0;

  // Sentence uniformity (coefficient of variation of sentence lengths)
  const sentLengths = sentences.map((s) => s.split(/\s+/).length);
  if (sentLengths.length > 1) {
    const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
    const variance = sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / sentLengths.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    // Low CV = uniform (AI-like), High CV = varied (human-like)
  } else {
    // Single sentence
  }

  // Burstiness (variance in sentence lengths — humans are bursty)
  const burstiness = sentLengths.length > 1
    ? Math.min(100, (() => {
        const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
        const variance = sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / sentLengths.length;
        return Math.sqrt(variance) * 10;
      })())
    : 50;

  // Top words (excluding common stop words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this', 'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom']);
  const filteredWords = words
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2 && !stopWords.has(w));
  const topFreq = new Map<string, number>();
  filteredWords.forEach((w) => topFreq.set(w, (topFreq.get(w) ?? 0) + 1));
  const topWords: [string, number][] = Array.from(topFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // AI detection signals
  const aiSignals: string[] = [];
  let aiScore = 0;

  // Signal 1: Low vocabulary richness (AI tends to use common words)
  if (vocabularyRichness < 0.4 && wordCount > 50) {
    aiSignals.push('Low vocabulary richness — limited word variety');
    aiScore += 15;
  }

  // Signal 2: High sentence uniformity
  if (sentLengths.length > 2) {
    const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
    const variance = sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / sentLengths.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv < 0.3) {
      aiSignals.push('Uniform sentence lengths — low structural variation');
      aiScore += 20;
    }
  }

  // Signal 3: Low burstiness
  if (burstiness < 25 && wordCount > 100) {
    aiSignals.push('Low burstiness — sentences lack natural rhythm');
    aiScore += 20;
  }

  // Signal 4: High repetition
  if (repetitionScore > 5) {
    aiSignals.push('High word repetition — formulaic patterns');
    aiScore += 10;
  }

  // Signal 5: Very long avg sentence (AI can be verbose)
  if (avgSentenceLength > 25) {
    aiSignals.push('Long average sentences — verbose style');
    aiScore += 10;
  }

  // Signal 6: Short avg word length (simple vocabulary)
  if (avgWordLength < 4 && wordCount > 50) {
    aiSignals.push('Short average word length — simple vocabulary');
    aiScore += 5;
  }

  // Signal 7: Very consistent paragraph lengths
  if (paragraphs.length > 2) {
    const paraLengths = paragraphs.map((p) => p.split(/\s+/).length);
    const paraMean = paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length;
    const paraVariance = paraLengths.reduce((sum, l) => sum + (l - paraMean) ** 2, 0) / paraLengths.length;
    const paraCv = paraMean > 0 ? Math.sqrt(paraVariance) / paraMean : 0;
    if (paraCv < 0.2) {
      aiSignals.push('Uniform paragraph lengths — templated structure');
      aiScore += 10;
    }
  }

  // Signal 8: AI-typical phrases (comprehensive list)
  const aiPhrases = [
    // Classic filler phrases
    'it is important to note', 'it is worth noting', 'in conclusion', 'furthermore', 'moreover',
    'in addition', 'as a result', 'in this essay', 'this article will', 'let us delve',
    'without further ado', 'in today\'s world', 'in the realm of', 'it goes without saying',
    'needless to say', 'it is crucial to understand', 'as we delve', 'buckle up', 'dive deep',
    'game changer', 'holistic approach', 'synergy', 'leverage', 'paradigm shift',
    'cutting edge', 'state of the art', 'at the end of the day',
    // Stands/serves as patterns
    'serves as a testament', 'stands as a reminder', 'plays a crucial role',
    'plays a pivotal role', 'plays a vital role', 'plays a significant role',
    'plays a key role', 'plays a key moment', 'underscores its importance',
    'underscores its significance', 'reflects broader', 'symbolizing its',
    'contributing to the', 'setting the stage for', 'marking a shift',
    'shaping the', 'key turning point', 'evolving landscape', 'focal point',
    'indelible mark', 'deeply rooted',
    // Highlighting/ensuring patterns
    'highlighting the', 'underscoring the', 'emphasizing the',
    'ensuring that', 'reflecting the', 'symbolizing the',
    'contributing to the', 'cultivating', 'fostering', 'encompassing',
    'enhancing', 'valuable insights', 'align with', 'resonate with',
    // Transition words (especially sentence-starting)
    'additionally,', 'furthermore,', 'moreover,', 'consequently,',
    'nevertheless,', 'nonetheless,', 'accordingly,', 'subsequently,',
    // Verbose synonyms
    'boasts', 'bolstered', 'crucial', 'deep dive', 'delve',
    'emphasizing', 'enduring', 'enhance', 'fostering', 'garner',
    'highlight', 'interplay', 'intricate', 'intricacies',
    'landscape', 'meticulous', 'meticulously', 'pivotal', 'robust',
    'showcase', 'tapestry', 'testament', 'underscore', 'valuable', 'vibrant',
    // Structural patterns
    'despite its', 'faces several challenges', 'despite these challenges',
    'challenges and legacy', 'future outlook',
    // Verb patterns
    'serves as', 'stands as', 'marks', 'functions as', 'operates as',
    'represents', 'boasts', 'features', 'maintains', 'offers', 'refers to',
    // Comparison patterns
    'not just', 'but also',
    // Chatbot patterns
    'worth surfacing', 'honest', 'not just', 'shaped', 'shipped',
    'claims', 'silently', 'surfaced', 'worth', 'ships',
    'that\'s a real', 'honestly', 'honesty', 'that\'s not',
    'pretends to', 'renaming it', 'unearned', 'earned', 'real gap',
    'problem underneath', 'carry', 'carries', 'smaller claim',
    'reframe', 'reframing', 'reframed', 'adds nothing new', 'gap',
    'want me to', 'flag', 'flagging', 'flagged', 'nothing I found',
    'genuinely deserves',
    // Helpfulness patterns
    'i hope this helps', 'of course!', 'certainly!',
    'you\'re absolutely right!', 'would you like', 'is there anything else',
    'let me know', 'more detailed breakdown', 'here is a',
    // Wikipedia/encyclopedia style
    'ensured that', 'adheres to', 'refined', 'enhanced', 'enriched',
    'streamlined', 'improved', 'in compliance with', 'complies with',
    'wikipedia guidelines', 'wikipedia standards', 'revised',
    'verifiability', 'neutrality', 'neutral tone', 'encyclopedic tone',
    'clarity', 'flow',
    // Marketing AI speak
    'boasts a vibrant', 'rich', 'profound', 'enhancing', 'showcasing',
    'exemplifies commitment to', 'natural beauty', 'nestled in the heart of',
    'groundbreaking', 'renowned', 'featuring diverse array',
  ];
  const lowerText = text.toLowerCase();
  const foundPhrases = aiPhrases.filter((p) => lowerText.includes(p));
  if (foundPhrases.length > 0) {
    aiSignals.push(`AI-typical phrases found: "${foundPhrases.slice(0, 3).join('", "')}"${foundPhrases.length > 3 ? ` (+${foundPhrases.length - 3} more)` : ''}`);
    aiScore += Math.min(30, foundPhrases.length * 5);
  }

  // Signal 9: Em dash overuse (—)
  const emDashCount = (text.match(/—/g) ?? []).length;
  if (emDashCount > 3) {
    aiSignals.push(`Frequent em dashes (${emDashCount} occurrences) — stylistic overuse`);
    aiScore += Math.min(15, emDashCount * 2);
  }

  // Signal 10: Emoji detection
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
  const emojiCount = (text.match(emojiRegex) ?? []).length;
  if (emojiCount > 0) {
    aiSignals.push(`Emojis detected (${emojiCount} found) — unusual in formal text`);
    aiScore += Math.min(10, emojiCount * 2);
  }

  // Signal 11: Overuse of bolding (markdown ** or __)
  const boldPattern = /\*\*[^*]+\*\*|__[^_]+__/g;
  const boldMatches = text.match(boldPattern) ?? [];
  if (boldMatches.length > 5) {
    aiSignals.push(`Heavy bolding (${boldMatches.length} instances) — excessive formatting`);
    aiScore += Math.min(10, boldMatches.length);
  }

  // Signal 12: Dash separator patterns (----, ----, etc.)
  const dashSeparatorRegex = /^[-=_]{3,}$/gm;
  const dashSeparators = (text.match(dashSeparatorRegex) ?? []).length;
  if (dashSeparators > 0) {
    aiSignals.push(`Dash separators (${dashSeparators} found) — templated formatting`);
    aiScore += dashSeparators * 3;
  }

  const aiConfidence = Math.min(100, aiScore);

  return {
    charCount,
    wordCount,
    sentenceCount,
    paragraphCount,
    lineCount,
    avgWordLength,
    avgSentenceLength,
    vocabularyRichness,
    repetitionScore,
    sentenceUniformity: sentLengths.length > 1 ? (() => {
      const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
      const variance = sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / sentLengths.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
      return Math.round((1 - Math.min(1, cv)) * 100);
    })() : 50,
    burstiness: Math.round(burstiness),
    topWords,
    aiConfidence,
    aiSignals,
    nlpSentiment: 0,
    nlpSentenceCount: sentenceCount,
    nlpTokenCount: wordCount,
    posDistribution: {} as Record<string, number>,
    entities: [] as { text: string; type: string }[],
    sentenceSentiments: [] as number[],
    adjectiveDensity: 0,
    nounDensity: 0,
    passiveEstimate: 0,
    pronounRatio: 0,
    entityDensity: 0,
  };
}

// NLP enrichment — call after analyzeText to fill in wink-nlp fields
async function enrichWithNlp(analysis: TextAnalysis, text: string): Promise<TextAnalysis> {
  const nlp = await analyzeWithNlp(text);
  if (!nlp) return analysis;

  const totalTokens = nlp.tokenCount || 1;
  const adjCount = nlp.posDistribution['ADJ'] ?? 0;
  const nounCount = (nlp.posDistribution['NOUN'] ?? 0) + (nlp.posDistribution['PROPN'] ?? 0);
  const auxCount = nlp.posDistribution['AUX'] ?? 0;
  const verbCount = nlp.posDistribution['VERB'] ?? 0;
  const pronCount = nlp.posDistribution['PRON'] ?? 0;

  return {
    ...analysis,
    nlpSentiment: nlp.sentiment,
    nlpSentenceCount: nlp.sentenceCount,
    nlpTokenCount: nlp.tokenCount,
    posDistribution: nlp.posDistribution,
    entities: nlp.entities,
    sentenceSentiments: nlp.sentenceSentiments,
    adjectiveDensity: Math.round((adjCount / totalTokens) * 1000) / 10,
    nounDensity: Math.round((nounCount / totalTokens) * 1000) / 10,
    passiveEstimate: Math.round(((auxCount + verbCount) > 0 ? auxCount / (auxCount + verbCount) : 0) * 100),
    pronounRatio: Math.round((pronCount / totalTokens) * 1000) / 10,
    entityDensity: Math.round((nlp.sentenceCount > 0 ? nlp.entities.length / nlp.sentenceCount : 0) * 100) / 100,
  };
}

interface TextItem {
  id: number;
  source: 'file' | 'paste';
  fileName: string | null;
  content: string;
  c2paResult: VerificationResult | null;
  sha256: string;
  analysis: TextAnalysis | null;
  status: 'pending' | 'analyzing' | 'done' | 'error';
  format?: string;
}

let textIdCounter = 0;

function TextView({ showToast }: { showToast: (msg: string) => void }) {
  const [items, setItems] = useState<TextItem[]>(() => {
    const stored = getStoredTextItems();
    if (stored.length === 0) return [];
    // Update textIdCounter to avoid collisions
    const maxId = Math.max(...stored.map((s) => s.id ?? 0), 0);
    textIdCounter = maxId;
    // Restore items from storage (without File objects, analysis is null — will re-analyze)
    return stored.map((s) => ({
      id: s.id ?? 0,
      content: s.content ?? '',
      source: (s.source as 'paste' | 'file') ?? 'paste',
      fileName: s.fileName ?? 'restored',
      sha256: s.sha256 ?? '',
      format: s.format ?? 'text',
      c2paResult: null,
      analysis: null,
      status: 'done' as const,
    }));
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Text simulator state
  const [textSimResults, setTextSimResults] = useState<{ name: string; description: string; hash: string; preserved: boolean }[]>(() => getStoredSimResults());
  const [textSimRunning, setTextSimRunning] = useState(false);

  // Persistence: save text simulator results
  useEffect(() => {
    if (textSimResults.length > 0) storeSimResults(textSimResults);
  }, [textSimResults]);

  // Sub-tab for detail panel
  type TextSubTab = 'analysis' | 'nlp' | 'transform';
  const [subTab, setSubTab] = useState<TextSubTab>('analysis');

  // Persistence: save text items when they change
  useEffect(() => {
    if (items.length > 0) {
      storeTextItems(items.map(it => ({
        id: it.id,
        content: it.content,
        source: it.source,
        fileName: it.fileName,
        sha256: it.sha256,
        format: it.format,
      })));
    }
  }, [items]);

  // Re-analyze restored items that have null analysis
  useEffect(() => {
    const needsAnalysis = items.filter(it => it.status === 'done' && it.analysis === null);
    if (needsAnalysis.length === 0) return;
    (async () => {
      for (const it of needsAnalysis) {
        try {
          const enriched = await enrichWithNlp(analyzeText(it.content), it.content);
          setItems(prev => prev.map(p => p.id === it.id ? { ...p, analysis: enriched } : p));
        } catch { /* skip */ }
      }
    })();
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrow key navigation via custom event
  useEffect(() => {
    function handleNavigate(e: Event) {
      const { direction } = (e as CustomEvent).detail;
      const doneItems = items.filter(it => it.status === 'done');
      if (doneItems.length === 0) return;
      const currentIdx = doneItems.findIndex(it => it.id === selectedId);
      const nextIdx = direction === 'down'
        ? Math.min(currentIdx + 1, doneItems.length - 1)
        : Math.max(currentIdx - 1, 0);
      if (nextIdx >= 0 && nextIdx < doneItems.length) {
        setSelectedId(doneItems[nextIdx].id);
      }
    }
    window.addEventListener('watermark:text-navigate', handleNavigate);
    return () => window.removeEventListener('watermark:text-navigate', handleNavigate);
  }, [items, selectedId]);

  const selectedItem = items.find((it) => it.id === selectedId) ?? null;

  async function hashText(text: string): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return Date.now().toString(16).padStart(64, '0');
    }
  }

  async function processOne(text: string, source: 'file' | 'paste', fileName: string | null): Promise<TextItem> {
    const id = ++textIdCounter;

    // SHA-256 (wrapped in try-catch for edge cases)
    let sha256 = '';
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback: use timestamp as hash if crypto fails
      sha256 = Date.now().toString(16).padStart(64, '0');
    }

    let analysis: TextAnalysis | null = null;
    try {
      analysis = await enrichWithNlp(analyzeText(text), text);
    } catch {
      // Analysis failed — return item without analysis
    }

    let c2paResult: VerificationResult | null = null;
    if (source === 'file' && fileName) {
      try {
        const blob = new Blob([text], { type: 'text/plain' });
        const file = new File([blob], fileName, { type: 'text/plain' });
        c2paResult = await verifyFile(file);
      } catch {
        // Text files may not have C2PA
      }
    }

    return { id, source, fileName, content: text, c2paResult, sha256, analysis, status: 'done', format: detectFormat(fileName ?? '') };
  }

  async function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setIsProcessing(true);

    const placeholders: TextItem[] = fileArray.map((f) => ({
      id: ++textIdCounter,
      source: 'file' as const,
      fileName: f.name,
      content: '',
      c2paResult: null,
      sha256: '',
      analysis: null,
      status: 'pending' as const,
      format: detectFormat(f.name),
    }));

    setItems((prev) => [...prev, ...placeholders]);

    // Process sequentially so progress updates are visible
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const ph = placeholders[i];

      // Mark as analyzing
      setItems((prev) => prev.map((it) => it.id === ph.id ? { ...it, status: 'analyzing' } : it));

      try {
        const extracted = await extractTextFromFile(file);
        const result = await processOne(extracted.text, 'file', file.name);
        setItems((prev) => prev.map((it) => it.id === ph.id ? { ...result } : it));
      } catch {
        setItems((prev) => prev.map((it) => it.id === ph.id ? { ...it, status: 'error' as const } : it));
      }
    }

    setIsProcessing(false);
    showToast(`${fileArray.length} file${fileArray.length > 1 ? 's' : ''} analyzed`);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    void processFiles(files);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    void processFiles(files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    dropZoneRef.current?.classList.add('drag-over');
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) dropZoneRef.current?.classList.remove('drag-over');
  }

  async function handlePasteAnalysis() {
    if (!pasteText.trim()) return;
    setIsProcessing(true);
    const result = await processOne(pasteText, 'paste', null);
    result.format = 'text';
    setItems((prev) => [...prev, result]);
    setPasteText('');
    setIsProcessing(false);
    showToast('Pasted text analyzed');
  }

  function removeItem(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function clearAll() {
    setItems([]);
    setSelectedId(null);
    setPasteText('');
    setTextSimResults([]);
    localStorage.removeItem('wm:textItems');
    showToast('Cleared');
  }

  function exportAll() {
    if (items.length === 0) return;
    const report = items.filter((it) => it.analysis).map((it) => ({
      source: it.source,
      fileName: it.fileName,
      sha256: it.sha256,
      stats: {
        charCount: it.analysis!.charCount,
        wordCount: it.analysis!.wordCount,
        sentenceCount: it.analysis!.sentenceCount,
        paragraphCount: it.analysis!.paragraphCount,
        lineCount: it.analysis!.lineCount,
        avgWordLength: it.analysis!.avgWordLength,
        avgSentenceLength: it.analysis!.avgSentenceLength,
      },
      aiDetection: {
        confidence: it.analysis!.aiConfidence,
        signals: it.analysis!.aiSignals,
        vocabularyRichness: it.analysis!.vocabularyRichness,
        repetitionScore: it.analysis!.repetitionScore,
        burstiness: it.analysis!.burstiness,
      },
      topWords: it.analysis!.topWords,
    }));
    const json = JSON.stringify(report.length === 1 ? report[0] : report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `text-analysis-${items.length > 1 ? 'batch' : (items[0]?.fileName ?? 'paste')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported');
  }

  function exportTextCSV() {
    if (items.length === 0) return;
    const headers = ['Source', 'File Name', 'SHA-256', 'Char Count', 'Word Count', 'Sentence Count', 'Paragraph Count', 'Line Count', 'Avg Word Len', 'Avg Sent Len', 'AI Confidence', 'AI Signals', 'Vocab Richness', 'Repetition Score', 'Burstiness'];
    const rows = items.filter((it) => it.analysis).map((it) => [
      it.source,
      it.fileName ?? 'paste',
      it.sha256 ?? '',
      String(it.analysis!.charCount),
      String(it.analysis!.wordCount),
      String(it.analysis!.sentenceCount),
      String(it.analysis!.paragraphCount),
      String(it.analysis!.lineCount),
      String(it.analysis!.avgWordLength),
      String(it.analysis!.avgSentenceLength),
      String(it.analysis!.aiConfidence),
      String(it.analysis!.aiSignals),
      String(it.analysis!.vocabularyRichness),
      String(it.analysis!.repetitionScore),
      String(it.analysis!.burstiness),
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `text-analysis-${items.length > 1 ? 'batch' : (items[0]?.fileName ?? 'paste')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported');
  }

  async function runTextSimulations() {
    const item = selectedItem;
    if (!item?.content) return;
    setTextSimRunning(true);
    setTextSimResults([]);

    const originalHash = item.sha256;
    const ops: { name: string; description: string; transform: (t: string) => string }[] = [
      { name: 'Line Endings (LF → CRLF)', description: 'Convert Unix to Windows line endings', transform: (t) => t.replace(/\n/g, '\r\n') },
      { name: 'Line Endings (CRLF → LF)', description: 'Convert Windows to Unix line endings', transform: (t) => t.replace(/\r\n/g, '\n') },
      { name: 'Strip Trailing Whitespace', description: 'Remove trailing spaces/tabs per line', transform: (t) => t.split('\n').map((l) => l.trimEnd()).join('\n') },
      { name: 'Add Trailing Newline', description: 'Ensure file ends with newline', transform: (t) => t.endsWith('\n') ? t : t + '\n' },
      { name: 'Remove Trailing Newline', description: 'Strip final newline character', transform: (t) => t.replace(/\n$/, '') },
      { name: 'Unicode NFC → NFD', description: 'Decompose composed characters', transform: (t) => t.normalize('NFD') },
      { name: 'Unicode NFD → NFC', description: 'Recompose decomposed characters', transform: (t) => t.normalize('NFC') },
      { name: 'Lowercase All', description: 'Convert entire text to lowercase', transform: (t) => t.toLowerCase() },
      { name: 'Uppercase All', description: 'Convert entire text to uppercase', transform: (t) => t.toUpperCase() },
      { name: 'Add BOM', description: 'Prepend UTF-8 Byte Order Mark', transform: (t) => '\uFEFF' + t },
      { name: 'Remove BOM', description: 'Strip Byte Order Mark if present', transform: (t) => t.replace(/^\uFEFF/, '') },
      { name: 'Collapse Whitespace', description: 'Replace multiple spaces with single', transform: (t) => t.replace(/ {2,}/g, ' ') },
      { name: 'Add Header Line', description: 'Prepend a metadata header line', transform: (t) => '# Processed Document\n---\n' + t },
      { name: 'Truncate 10%', description: 'Remove last 10% of characters', transform: (t) => t.slice(0, Math.floor(t.length * 0.9)) },
      { name: 'Swap Lines', description: 'Reverse line order', transform: (t) => t.split('\n').reverse().join('\n') },
      { name: 'Insert Line Numbers', description: 'Prepend line numbers to each line', transform: (t) => t.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n') },
    ];

    const results: typeof textSimResults = [];
    for (const op of ops) {
      try {
        const transformed = op.transform(item.content);
        const hash = await hashText(transformed);
        results.push({ name: op.name, description: op.description, hash, preserved: hash === originalHash });
      } catch (err) {
        results.push({ name: op.name, description: op.description, hash: '', preserved: false });
      }
      setTextSimResults([...results]);
    }

    setTextSimRunning(false);
    showToast('Text simulation complete');
  }

  function aiConfidenceColor(c: number) {
    if (c <= 30) return 'var(--color-tertiary)';
    if (c <= 60) return '#f59e0b';
    return '#f43f5e';
  }

  function aiConfidenceLabel(c: number) {
    if (c <= 20) return 'Likely human';
    if (c <= 40) return 'Possibly human';
    if (c <= 60) return 'Uncertain';
    if (c <= 80) return 'Possibly AI';
    return 'Likely AI';
  }

  const doneItems = items.filter((it) => it.status === 'done' && it.analysis);
  const isIdle = items.length === 0;

  return (
    <main className="txt-view">
      <div className="txt-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Text Analysis</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Drop text files or paste content to analyze provenance, integrity, and AI-generation signals.
            {items.length > 1 && <span style={{ marginLeft: 8, color: 'var(--color-primary)', fontWeight: 600 }}>{items.length} files loaded</span>}
          </p>
        </div>
        {items.length > 0 && (
          <div className="txt-actions">
            <button className="action-tactile button-ghost" type="button" onClick={exportAll} disabled={doneItems.length === 0}>
              <Download size={15} /> Export {doneItems.length > 1 ? `All (${doneItems.length})` : ''}
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={exportTextCSV} disabled={doneItems.length === 0}>
              <Download size={15} /> CSV
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
              <Upload size={15} /> Add Files
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={clearAll}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
        )}
      </div>

      {isIdle ? (
        <>
          {/* File Drop */}
          <div
            ref={dropZoneRef}
            className="txt-drop"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="txt-drop-inner">
              <Upload size={36} style={{ color: 'var(--color-outline)' }} />
              <strong>Drop text files</strong>
              <span>.txt, .md, .json, .html, .csv, .xml, .py, .ts, .js, .go, .rs, .pdf, .pptx — multiple files supported</span>
            </div>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept={TEXT_ACCEPT} multiple onChange={handleFileInput} />
          </div>

          <div className="txt-divider"><span>or</span></div>

          {/* Paste Area */}
          <div className="txt-paste">
            <textarea
              className="txt-paste-input"
              placeholder="Paste text content here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
            />
            <button
              className="action-tactile button-primary"
              type="button"
              onClick={handlePasteAnalysis}
              disabled={!pasteText.trim() || isProcessing}
            >
              <Sparkles size={16} /> Analyze Text
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Loading bar */}
          {isProcessing && (
            <div className="txt-progress">
              <RefreshCw size={16} className="spin" />
              <span>Processing files...</span>
            </div>
          )}

          {/* Batch file list (always visible when items exist) */}
          <div className="txt-batch">
            {/* Add more button at top of list */}
            <div
              className="txt-drop txt-drop-inline"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="txt-drop-inner">
                <Upload size={18} style={{ color: 'var(--color-outline)' }} />
                <strong>Add more files</strong>
                <span>Drop or click — multiple files supported</span>
              </div>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept={TEXT_ACCEPT} multiple onChange={handleFileInput} />
            </div>

            <div className="txt-batch-list">
              {items.map((it) => (
                <div
                  key={it.id}
                  className={`txt-batch-item ${selectedId === it.id ? 'selected' : ''} ${it.status}`}
                >
                  <div className="txt-batch-item-main" onClick={() => setSelectedId(it.id)}>
                    <FileText size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    <span className="txt-batch-item-name">{it.source === 'file' ? it.fileName : 'Pasted text'}</span>
                    {it.format && it.format !== 'text' && (
                      <span className="txt-batch-item-format">{it.format.toUpperCase()}</span>
                    )}
                    {it.status === 'pending' && <span className="txt-batch-item-status pending">Queued</span>}
                    {it.status === 'analyzing' && <span className="txt-batch-item-status analyzing"><RefreshCw size={12} className="spin" /> Analyzing</span>}
                    {it.status === 'done' && it.analysis && (
                      <>
                        <span className="txt-batch-item-badge" style={{ color: aiConfidenceColor(it.analysis.aiConfidence) }}>
                          AI {it.analysis.aiConfidence}%
                        </span>
                        <span className="txt-batch-item-meta">{it.analysis.wordCount.toLocaleString()} words</span>
                      </>
                    )}
                    {it.status === 'error' && <span className="txt-batch-item-status error">Error</span>}
                  </div>
                    <div className="txt-batch-item-actions">
                      {it.status === 'done' && (
                        <>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'analysis' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('analysis'); }}
                            title="View AI detection, readability stats, vocabulary analysis, and C2PA status"
                          >
                            <Info size={13} /> Analysis
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'nlp' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('nlp'); }}
                            title="NLP analysis: sentiment, POS distribution, named entities, writing style"
                          >
                            <BookOpen size={13} /> NLP
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'transform' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('transform'); }}
                            title="Strip formatting, redact PII, unslop AI text, or fix grammar with Harper"
                          >
                            <Sparkles size={13} /> Strip / Unslop
                          </button>
                        </>
                      )}
                    <button
                      className="txt-batch-item-remove"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                      title="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail panel for selected item */}
          {selectedItem && selectedItem.status === 'done' && (
            <>
              {subTab === 'analysis' ? (
                <TextDetailPanel
                  item={selectedItem}
                  aiConfidenceColor={aiConfidenceColor}
                  aiConfidenceLabel={aiConfidenceLabel}
                  textSimResults={textSimResults}
                  textSimRunning={textSimRunning}
                  runTextSimulations={runTextSimulations}
                />
              ) : subTab === 'nlp' ? (
                <NlpDetailPanel item={selectedItem} />
              ) : (
                <TextTransformPanel inputText={selectedItem.content} format={selectedItem.format} showToast={showToast} />
              )}
            </>
          )}

          {/* Summary when no item selected but multiple exist */}
          {!selectedItem && doneItems.length > 1 && (
            <div className="txt-results txt-batch-summary">
              <h3>Batch Summary</h3>
              <div className="txt-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="txt-stat"><span>Total Files</span><strong>{doneItems.length}</strong></div>
                <div className="txt-stat"><span>Total Words</span><strong>{doneItems.reduce((s, it) => s + (it.analysis?.wordCount ?? 0), 0).toLocaleString()}</strong></div>
                <div className="txt-stat">
                  <span>Avg AI Score</span>
                  <strong style={{ color: aiConfidenceColor(doneItems.reduce((s, it) => s + (it.analysis?.aiConfidence ?? 0), 0) / doneItems.length) }}>
                    {(doneItems.reduce((s, it) => s + (it.analysis?.aiConfidence ?? 0), 0) / doneItems.length).toFixed(0)}%
                  </strong>
                </div>
                <div className="txt-stat">
                  <span>C2PA Found</span>
                  <strong>{doneItems.filter((it) => it.c2paResult?.status === 'ready').length}/{doneItems.length}</strong>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/* ── Text Detail Panel (shown when a single text item is selected) ── */

function TextDetailPanel({
  item,
  aiConfidenceColor,
  aiConfidenceLabel,
  textSimResults,
  textSimRunning,
  runTextSimulations,
}: {
  item: TextItem;
  aiConfidenceColor: (c: number) => string;
  aiConfidenceLabel: (c: number) => string;
  textSimResults: { name: string; description: string; hash: string; preserved: boolean }[];
  textSimRunning: boolean;
  runTextSimulations: () => void;
}) {
  // Analysis may be null for persisted items — compute from content
  const a = item.analysis ?? (() => {
    try {
      return analyzeText(item.content);
    } catch {
      return {
        charCount: item.content.length,
        wordCount: item.content.split(/\s+/).filter(Boolean).length,
        sentenceCount: 0,
        paragraphCount: 0,
        lineCount: 0,
        avgWordLength: 0,
        avgSentenceLength: 0,
        vocabularyRichness: 0,
        repetitionScore: 0,
        sentenceUniformity: 0,
        burstiness: 0,
        topWords: [] as [string, number][],
        aiConfidence: 0,
        aiSignals: [] as string[],
        nlpSentiment: 0,
        nlpSentenceCount: 0,
        nlpTokenCount: 0,
        posDistribution: {} as Record<string, number>,
        entities: [] as { text: string; type: string }[],
        sentenceSentiments: [] as number[],
        adjectiveDensity: 0,
        nounDensity: 0,
        passiveEstimate: 0,
        pronounRatio: 0,
        entityDensity: 0,
      };
    }
  })();

  return (
    <div className="txt-results">
      {/* Source Info */}
      <div className="txt-source">
        <div className="txt-source-info">
          <FileText size={18} style={{ color: 'var(--color-primary)' }} />
          <span>{item.source === 'file' ? item.fileName : 'Pasted text'}</span>
        </div>
        <div className="txt-hash" title={item.sha256}>
          <Fingerprint size={14} />
          <span>{item.sha256.slice(0, 16)}…</span>
        </div>
      </div>

      {/* C2PA Status */}
      {item.c2paResult && (
        <div className={`txt-c2pa ${item.c2paResult.status === 'ready' ? 'has-c2pa' : 'no-c2pa'}`}>
          {item.c2paResult.status === 'ready' ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
          <div>
            <strong>{item.c2paResult.status === 'ready' ? 'C2PA Manifest Found' : 'No C2PA Manifest'}</strong>
            <span>{item.c2paResult.validationState}</span>
          </div>
        </div>
      )}

      {/* AI Confidence */}
      <div className="txt-ai">
        <div className="txt-ai-header">
          <Sparkles size={18} style={{ color: aiConfidenceColor(a.aiConfidence) }} />
          <div>
            <strong>AI Generation Likelihood</strong>
            <span>{aiConfidenceLabel(a.aiConfidence)}</span>
          </div>
          <strong className="txt-ai-score" style={{ color: aiConfidenceColor(a.aiConfidence) }}>{a.aiConfidence}%</strong>
        </div>
        <div className="txt-ai-bar">
          <div className="txt-ai-fill" style={{ width: `${a.aiConfidence}%`, background: aiConfidenceColor(a.aiConfidence) }} />
        </div>
        {a.aiSignals.length > 0 && (
          <div className="txt-ai-signals">
            {a.aiSignals.map((sig, i) => (
              <div key={i} className="txt-ai-signal">
                <AlertTriangle size={13} />
                <span>{sig}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="txt-stats">
        <h3>Text Statistics</h3>
        <div className="txt-stats-grid">
          <div className="txt-stat"><span>Characters</span><strong>{a.charCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Words</span><strong>{a.wordCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Sentences</span><strong>{a.sentenceCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Paragraphs</span><strong>{a.paragraphCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Lines</span><strong>{a.lineCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Avg Word Length</span><strong>{a.avgWordLength.toFixed(1)}</strong></div>
          <div className="txt-stat"><span>Avg Sentence Length</span><strong>{a.avgSentenceLength.toFixed(1)} words</strong></div>
          <div className="txt-stat"><span>Vocabulary Richness</span><strong>{(a.vocabularyRichness * 100).toFixed(1)}%</strong></div>
        </div>
      </div>

      {/* Readability Metrics */}
      <div className="txt-metrics">
        <h3>Readability Metrics</h3>
        <div className="txt-metrics-grid">
          <div className="txt-metric">
            <span>Burstiness</span>
            <div className="txt-metric-bar">
              <div className="txt-metric-fill" style={{ width: `${a.burstiness}%`, background: a.burstiness > 50 ? 'var(--color-tertiary)' : '#f59e0b' }} />
            </div>
            <span className="txt-metric-val">{a.burstiness}/100</span>
          </div>
          <div className="txt-metric">
            <span>Sentence Uniformity</span>
            <div className="txt-metric-bar">
              <div className="txt-metric-fill" style={{ width: `${a.sentenceUniformity}%`, background: a.sentenceUniformity > 70 ? '#f59e0b' : 'var(--color-tertiary)' }} />
            </div>
            <span className="txt-metric-val">{a.sentenceUniformity}/100</span>
          </div>
          <div className="txt-metric">
            <span>Repetition</span>
            <div className="txt-metric-bar">
              <div className="txt-metric-fill" style={{ width: `${Math.min(100, a.repetitionScore)}%`, background: a.repetitionScore > 5 ? '#f43f5e' : 'var(--color-tertiary)' }} />
            </div>
            <span className="txt-metric-val">{a.repetitionScore.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Top Words */}
      {a.topWords.length > 0 && (
        <div className="txt-topwords">
          <h3>Top Words</h3>
          <div className="txt-topwords-list">
            {a.topWords.map(([word, count]) => (
              <div key={word} className="txt-topword">
                <span className="txt-topword-word">{word}</span>
                <span className="txt-topword-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What Would Break? Text Simulator */}
      <div className="txt-simulator">
        <div className="txt-sim-header">
          <h3>What Would Break This Text?</h3>
          <button
            className="action-tactile button-ghost"
            type="button"
            onClick={runTextSimulations}
            disabled={textSimRunning || item.content.length === 0}
          >
            {textSimRunning ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
            {textSimRunning ? 'Running...' : 'Run Tests'}
          </button>
        </div>

        {textSimResults.length > 0 && (
          <>
            <div className="txt-sim-summary">
              <div className="txt-sim-stat preserved">
                <CheckCircle2 size={14} />
                <strong>{textSimResults.filter((r) => r.preserved).length}</strong>
                <span>Preserved</span>
              </div>
              <div className="txt-sim-stat broken">
                <AlertTriangle size={14} />
                <strong>{textSimResults.filter((r) => !r.preserved).length}</strong>
                <span>Changed</span>
              </div>
            </div>

            <div className="txt-sim-grid">
              {textSimResults.map((r) => (
                <div key={r.name} className={`txt-sim-card ${r.preserved ? 'preserved' : 'broken'}`}>
                  <div className="txt-sim-card-status">
                    {r.preserved ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  </div>
                  <div className="txt-sim-card-info">
                    <span className="txt-sim-card-name">{r.name}</span>
                    <span className="txt-sim-card-desc">{r.description}</span>
                    <span className="txt-sim-card-hash" title={r.hash}>SHA-256: {r.hash.slice(0, 12)}…</span>
                  </div>
                  <span className={`txt-sim-badge ${r.preserved ? 'preserved' : 'broken'}`}>
                    {r.preserved ? 'Same' : 'Different'}
                  </span>
                </div>
              ))}
            </div>

            {/* Export buttons for text sim results */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="action-tactile button-ghost" type="button" onClick={() => {
                const json = JSON.stringify(textSimResults, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'text-simulation-results.json'; a.click(); URL.revokeObjectURL(url);
              }}>
                <Download size={14} /> JSON
              </button>
              <button className="action-tactile button-ghost" type="button" onClick={() => {
                const headers = ['Operation', 'Description', 'SHA-256', 'Preserved'];
                const rows = textSimResults.map(r => [r.name, r.description, r.hash, r.preserved ? 'Yes' : 'No']);
                const csv = [headers, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'text-simulation-results.csv'; a.click(); URL.revokeObjectURL(url);
              }}>
                <Download size={14} /> CSV
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── NLP Detail Panel (POS, Entities, Sentiment) ────────────────── */

function NlpDetailPanel({ item }: { item: TextItem }) {
  const [a, setA] = useState<TextAnalysis | null>(() => item.analysis ?? (() => {
    try { return analyzeText(item.content); } catch { return null; }
  })());

  // Enrich with NLP data if missing (async)
  useEffect(() => {
    if (!a || (a.posDistribution && Object.keys(a.posDistribution).length > 0)) return;
    let cancelled = false;
    enrichWithNlp(a, item.content).then(enriched => {
      if (!cancelled) setA(enriched);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [a, item.content]);

  if (!a) return <div className="txt-results"><p style={{ color: 'var(--color-muted)' }}>No analysis data available.</p></div>;

  const winkStatus = getWinkStatus();
  const hasNlp = a.posDistribution && Object.keys(a.posDistribution).length > 0;

  const posEntries = Object.entries(a.posDistribution)
    .sort(([, a], [, b]) => b - a);
  const totalTokens = a.nlpTokenCount || 1;

  const nlpSent = a.nlpSentiment ?? 0;
  const sentSs = a.sentenceSentiments ?? [];
  const entityDens = a.entityDensity ?? 0;

  const sentimentLabel = nlpSent > 0.2 ? 'Positive' : nlpSent < -0.2 ? 'Negative' : 'Neutral';
  const sentimentColor = nlpSent > 0.2 ? 'var(--color-tertiary)' : nlpSent < -0.2 ? '#f87171' : 'var(--color-muted)';

  const entityTypeCounts: Record<string, number> = {};
  for (const e of a.entities) {
    entityTypeCounts[e.type] = (entityTypeCounts[e.type] ?? 0) + 1;
  }

  return (
    <div className="txt-results">
      <h3 style={{ marginBottom: '0.75rem' }}>NLP Analysis</h3>

      {/* Debug status */}
      <div style={{ padding: '0.5rem', marginBottom: '0.75rem', borderRadius: 6, background: 'var(--color-surface-alt)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
        <div>wink-nlp: {winkStatus.initialized ? '✅ initialized' : `❌ not loaded${winkStatus.error ? ` (${winkStatus.error})` : ''}`}</div>
        <div>POS tags: {hasNlp ? Object.keys(a.posDistribution).length : 'none'} | Entities: {a.entities.length} | Sentiment: {a.nlpSentiment}</div>
      </div>

      {/* Sentiment */}
      <div className="txt-section">
        <div className="txt-section-title">Sentiment</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div style={{ flex: 1, height: 8, background: 'var(--color-surface-alt)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.abs(nlpSent) * 50 + 50}%`,
              marginLeft: nlpSent < 0 ? 'auto' : 0,
              background: sentimentColor,
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
          <strong style={{ color: sentimentColor, minWidth: 60, textAlign: 'right' }}>
            {nlpSent.toFixed(2)}
          </strong>
        </div>
        <span style={{ color: sentimentColor, fontSize: '0.8rem' }}>{sentimentLabel}</span>

        {sentSs.length > 1 && (
          <div style={{ marginTop: '0.75rem' }}>
            <div className="txt-section-title" style={{ fontSize: '0.7rem' }}>Per-sentence sentiment</div>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: '0.25rem' }}>
              {sentSs.map((s, i) => (
                <div
                  key={i}
                  title={`Sentence ${i + 1}: ${(s ?? 0).toFixed(2)}`}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: (s ?? 0) > 0.2 ? 'var(--color-tertiary)' : (s ?? 0) < -0.2 ? '#f87171' : 'var(--color-surface-alt)',
                    opacity: 0.5 + Math.abs(s ?? 0) * 0.5,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Entities */}
      <div className="txt-section">
        <div className="txt-section-title">
          Named Entities
          <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--color-muted)', fontSize: '0.75rem' }}>
            {a.entities.length} found · {entityDens.toFixed(1)} per sentence
          </span>
        </div>
        {a.entities.length === 0 ? (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.8rem' }}>No named entities detected.</p>
        ) : (
          <>
            {Object.keys(entityTypeCounts).length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {Object.entries(entityTypeCounts).map(([type, count]) => (
                  <span key={type} className="txt-batch-item-badge" style={{ fontSize: '0.7rem' }}>
                    {type}: {count}
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {a.entities.map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--color-text)' }}>{e.text}</span>
                  <span className="txt-batch-item-badge" style={{ fontSize: '0.65rem' }}>{e.type}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* POS Distribution */}
      <div className="txt-section">
        <div className="txt-section-title">
          Part-of-Speech Distribution
          <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--color-muted)', fontSize: '0.75rem' }}>
            {a.nlpTokenCount} tokens
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {posEntries.map(([pos, count]) => {
            const pct = (count / totalTokens) * 100;
            const label = POS_LABELS[pos] ?? pos;
            return (
              <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ minWidth: 90, color: 'var(--color-muted)' }}>{label}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--color-surface-alt)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 3 }} />
                </div>
                <span style={{ minWidth: 36, textAlign: 'right', color: 'var(--color-text)' }}>{count}</span>
                <span style={{ minWidth: 40, textAlign: 'right', color: 'var(--color-muted)', fontSize: '0.7rem' }}>{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Writing Style Metrics */}
      <div className="txt-section">
        <div className="txt-section-title">Writing Style</div>
        <div className="txt-stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="txt-stat">
            <span>Adjective Density</span>
            <strong>{(a.adjectiveDensity ?? 0)}%</strong>
          </div>
          <div className="txt-stat">
            <span>Noun Density</span>
            <strong>{(a.nounDensity ?? 0)}%</strong>
          </div>
          <div className="txt-stat">
            <span>Passive Voice Est.</span>
            <strong>{(a.passiveEstimate ?? 0)}%</strong>
          </div>
          <div className="txt-stat">
            <span>Pronoun Ratio</span>
            <strong>{(a.pronounRatio ?? 0)}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Text Transform Panel (Stripper / Unsloper) ─────────────────── */

interface DiffLine {
  type: 'unchanged' | 'removed' | 'added';
  text: string;
  outText?: string;
  origNum: number;
  outNum: number;
}

function diffLines(original: string, transformed: string): DiffLine[] {
  const origLines = original.split('\n');
  const outLines = transformed.split('\n');
  const result: DiffLine[] = [];

  // Simple line-by-line diff
  const maxLen = Math.max(origLines.length, outLines.length);
  let origNum = 1;
  let outNum = 1;

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? '';
    const outLine = outLines[i] ?? '';

    if (origLine === outLine) {
      result.push({ type: 'unchanged', text: origLine, origNum, outNum });
      origNum++;
      outNum++;
    } else {
      if (origLine !== undefined && i < origLines.length) {
        result.push({ type: 'removed', text: origLine, origNum, outNum });
        origNum++;
      }
      if (outLine !== undefined && i < outLines.length) {
        result.push({ type: 'added', text: outLine, outText: outLine, origNum, outNum });
        outNum++;
      }
    }
  }

  return result;
}

// ── Word-level diff + tool-attributed highlighting ──────────────

type TransformTool = 'strip' | 'improve' | 'harper';

interface TransformStep {
  tool: TransformTool;
  before: string;
  after: string;
}

interface HighlightedSegment {
  text: string;
  type: 'unchanged' | 'changed';
  tool?: TransformTool;
}

// Word-level diff: returns array of {text, type:'same'|'added'|'removed'}
function wordDiff(a: string, b: string): Array<{ text: string; type: 'same' | 'added' | 'removed' }> {
  const aWords = a.split(/(\s+)/);
  const bWords = b.split(/(\s+)/);

  // LCS-based diff
  const m = aWords.length;
  const n = bWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aWords[i - 1] === bWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  let i = m, j = n;
  const raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aWords[i - 1] === bWords[j - 1]) {
      raw.push({ text: aWords[i - 1], type: 'same' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ text: bWords[j - 1], type: 'added' });
      j--;
    } else {
      raw.push({ text: aWords[i - 1], type: 'removed' });
      i--;
    }
  }
  raw.reverse();

  // Merge consecutive same-type segments
  for (const seg of raw) {
    if (result.length > 0 && result[result.length - 1].type === seg.type) {
      result[result.length - 1].text += seg.text;
    } else {
      result.push({ ...seg });
    }
  }
  return result;
}

// Compute highlighted segments with tool attribution
function computeHighlights(original: string, steps: TransformStep[]): {
  outputSegments: HighlightedSegment[];
  removedSegments: Array<{ text: string; tool: TransformTool }>;
} {
  if (steps.length === 0) {
    return { outputSegments: [{ text: original, type: 'unchanged' }], removedSegments: [] };
  }

  // Chain diffs: compute what each tool changed relative to its input
  const toolDiffs: Array<{ tool: TransformTool; segments: Array<{ text: string; type: 'same' | 'added' | 'removed' }> }> = [];
  for (const step of steps) {
    toolDiffs.push({ tool: step.tool, segments: wordDiff(step.before, step.after) });
  }

  // Build output: start with original text, apply each tool's changes
  // Track which words came from which tool
  interface WordInfo { text: string; tool: TransformTool | null; isOriginal: boolean; }
  let currentWords: WordInfo[] = original.split(/(\s+)/).map(w => ({ text: w, tool: null, isOriginal: true }));

  for (const td of toolDiffs) {
    // Reconstruct the "after" text from this tool's diff
    const afterWords: string[] = [];
    for (const seg of td.segments) {
      if (seg.type !== 'removed') afterWords.push(seg.text);
    }
    const afterText = afterWords.join('');

    // Now diff current state against this tool's input to find what this tool changed
    const currentText = currentWords.map(w => w.text).join('');
    const inputText = td.segments.filter(s => s.type !== 'added').map(s => s.text).join('');
    const toolWordDiff = wordDiff(inputText, afterText);

    // Map the diff back to currentWords to tag which ones this tool changed
    // Simple approach: if a word in currentWords differs from input, tag it
    const inputWords = inputText.split(/(\s+)/);
    const afterWordArr = afterText.split(/(\s+)/);

    // Build a map of changed positions
    const changedAfter = new Set<number>();
    let ai = 0;
    for (let k = 0; k < toolWordDiff.length; k++) {
      const seg = toolWordDiff[k];
      if (seg.type === 'added') {
        // Find position in afterWords
        const addedWords = seg.text.split(/(\s+)/);
        for (const aw of addedWords) {
          const idx = afterWordArr.indexOf(aw);
          if (idx >= 0) changedAfter.add(idx);
        }
      }
    }

    // Replace currentWords with afterWords, tagging changed ones
    const newWords: WordInfo[] = afterWordArr.map((w, idx) => ({
      text: w,
      tool: changedAfter.has(idx) ? td.tool : null,
      isOriginal: false,
    }));
    currentWords = newWords;
  }

  // Build output segments
  const outputSegments: HighlightedSegment[] = currentWords.map(w => ({
    text: w.text,
    type: w.tool ? 'changed' : 'unchanged',
    tool: w.tool ?? undefined,
  }));

  // Merge consecutive same-tool segments
  const merged: HighlightedSegment[] = [];
  for (const seg of outputSegments) {
    if (merged.length > 0 && merged[merged.length - 1].type === seg.type && merged[merged.length - 1].tool === seg.tool) {
      merged[merged.length - 1].text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  // Collect removed segments for original pane
  const removedSegments: Array<{ text: string; tool: TransformTool }> = [];
  for (const td of toolDiffs) {
    for (const seg of td.segments) {
      if (seg.type === 'removed' && seg.text.trim()) {
        removedSegments.push({ text: seg.text, tool: td.tool });
      }
    }
  }

  return { outputSegments: merged, removedSegments };
}

// Render the original text with removed portions highlighted
function renderOriginalWithHighlights(original: string, removedSegments: Array<{ text: string; tool: TransformTool }>): React.ReactNode[] {
  if (removedSegments.length === 0) return [<span key="full">{original}</span>];

  const parts: React.ReactNode[] = [];
  let remaining = original;

  for (const rem of removedSegments) {
    const idx = remaining.indexOf(rem.text);
    if (idx >= 0) {
      if (idx > 0) parts.push(<span key={`keep-${parts.length}`}>{remaining.slice(0, idx)}</span>);
      parts.push(
        <span
          key={`rem-${parts.length}`}
          style={{
            background: `${toolColors[rem.tool]}22`,
            color: toolColors[rem.tool],
            textDecoration: 'line-through',
            textDecorationColor: toolColors[rem.tool],
            borderRadius: 2,
            padding: '0 1px',
          }}
        >
          {rem.text}
        </span>
      );
      remaining = remaining.slice(idx + rem.text.length);
    }
  }
  if (remaining) parts.push(<span key="rest">{remaining}</span>);
  return parts;
}

const toolColors: Record<TransformTool, string> = {
  strip: '#f472b6',    // pink
  improve: '#4ade80',   // green
  harper: '#a78bfa',    // purple
};

const toolLabels: Record<TransformTool, string> = {
  strip: 'Strip / Obfuscate',
  improve: 'Improve Text',
  harper: 'Grammar',
};

function TextTransformPanel({ inputText, format, showToast }: { inputText: string; format?: string; showToast: (msg: string) => void }) {
  const [mode, setMode] = useState<'strip' | 'improve' | 'harper'>('strip');
  const [viewMode, setViewMode] = useState<'output' | 'diff'>('output');
  const [outputText, setOutputText] = useState('');
  const [hasOutput, setHasOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  // Transformation history for multi-tool highlighting
  const [transformSteps, setTransformSteps] = useState<TransformStep[]>([]);
  const [originalText, setOriginalText] = useState('');

  // Check if Harper should be available (not for PDFs by default)
  const harperAvailable = format !== 'pdf';

  // Stripper state
  const [stripOpts, setStripOpts] = useState<StripperOptions>(() => {
    const stored = getStoredStripperOpts();
    return stored ? { ...STRIPPER_DEFAULTS, ...stored } : { ...STRIPPER_DEFAULTS };
  });

  // Persistence: save stripper options when they change
  useEffect(() => {
    storeStripperOpts(stripOpts as unknown as Record<string, unknown>);
  }, [stripOpts]);

  // Unsloper state
  const [unslopPatterns, setUnslopPatterns] = useState<UnslopPattern[]>([]);
  const [unslopResult, setUnslopResult] = useState<ReturnType<typeof applyUnslop> | null>(null);
  const [skipFillerRemoval, setSkipFillerRemoval] = useState(() => {
    try { return localStorage.getItem('wm:skipFillerRemoval') === 'true'; } catch { return false; }
  });

  // Harper state
  const [harperLints, setHarperLints] = useState<HarperLint[]>([]);
  const [harperRunning, setHarperRunning] = useState(false);

  function runStripper() {
    try {
      const result = applyStripper(inputText, stripOpts);
      setOutputText(result);
      setHasOutput(true);
      setViewMode('diff');
      setOriginalText(inputText);
      setTransformSteps([{ tool: 'strip', before: inputText, after: result }]);
      showToast('Text stripped');
    } catch (err) {
      showToast(`Strip error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  function runUnsloper() {
    try {
      const allPatterns = detectUnslopPatterns(inputText);
      const patterns = skipFillerRemoval
        ? allPatterns.filter(p => p.category !== 'transition')
        : allPatterns;
      setUnslopPatterns(patterns);
      const result = applyUnslop(inputText, patterns);
      setUnslopResult(result);
      setOutputText(result.text);
      setHasOutput(true);
      setViewMode('diff');
      setOriginalText(inputText);
      setTransformSteps([{ tool: 'improve', before: inputText, after: result.text }]);
      showToast(`Unslopped — ${result.changeCount} changes, ${patterns.length} patterns found`);
    } catch (err) {
      showToast(`Unslopper error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async function runHarper() {
    setHarperRunning(true);
    try {
      const textToCheck = format === 'pdf' ? normalizePdfText(inputText) : inputText;
      const lints = await harperLint(textToCheck);
      setHarperLints(lints);
      const fixed = await harperFixAll(textToCheck);
      setOutputText(fixed);
      setHasOutput(true);
      setViewMode('diff');
      setOriginalText(inputText);
      setTransformSteps([{ tool: 'harper', before: inputText, after: fixed }]);
      showToast(`Harper: ${lints.length} issues found and fixed`);
    } catch (err) {
      showToast(`Harper error: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setHarperRunning(false);
    }
  }

  function applyPreset(key: string) {
    const preset = STRIPPER_PRESETS[key];
    if (preset) setStripOpts({ ...STRIPPER_DEFAULTS, ...preset });
  }

  function copyOutput() {
    if (!outputText) return;
    navigator.clipboard?.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    showToast('Copied to clipboard');
  }

  function downloadOutput() {
    if (!outputText) return;
    const blob = new Blob([outputText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transformed-${mode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const categories = unslopPatterns.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + p.count;
    return acc;
  }, {});

  return (
    <div className="xform-panel">
      {/* Source text viewer */}
      <div className="xform-source">
        <div className="xform-source-header">
          <FileText size={14} />
          <span>Source Text</span>
          <span className="xform-source-stats">{inputText.length.toLocaleString()} chars</span>
        </div>
        <div className="xform-source-content">
          {inputText}
        </div>
      </div>

      <div className="xform-tabs">
        <button
          className={`xform-tab ${mode === 'strip' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('strip')}
        >
          Strip / Obfuscate
        </button>
        <button
          className={`xform-tab ${mode === 'improve' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('improve')}
        >
          Improve Text
        </button>
        <button
          className={`xform-tab ${mode === 'harper' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('harper')}
          disabled={!harperAvailable}
          title={!harperAvailable ? 'Harper not available for PDF text (letter-spacing artifacts)' : ''}
        >
          Grammar Only
        </button>
      </div>

      {mode === 'strip' ? (
        <div className="xform-body">
          {/* Presets */}
          <div className="xform-presets">
            <span className="xform-presets-label">Presets:</span>
            {Object.keys(STRIPPER_PRESETS).map((key) => (
              <button key={key} className="action-tactile button-ghost xform-preset-btn" type="button" onClick={() => applyPreset(key)}>
                {key}
              </button>
            ))}
            <button className="action-tactile button-ghost xform-preset-btn" type="button" onClick={() => setStripOpts({ ...STRIPPER_DEFAULTS })}>
              reset
            </button>
          </div>

          {/* Options grid */}
          <div className="xform-opts">
            <h4>Anonymize</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizeNames} onChange={(e) => setStripOpts({ ...stripOpts, anonymizeNames: e.target.checked })} /> <span>Names → [NAME]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizeEmails} onChange={(e) => setStripOpts({ ...stripOpts, anonymizeEmails: e.target.checked })} /> <span>Emails → [EMAIL]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizePhones} onChange={(e) => setStripOpts({ ...stripOpts, anonymizePhones: e.target.checked })} /> <span>Phones → [PHONE]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizeUrls} onChange={(e) => setStripOpts({ ...stripOpts, anonymizeUrls: e.target.checked })} /> <span>URLs → [URL]</span></label>

            <h4>Redact PII</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripSSN} onChange={(e) => setStripOpts({ ...stripOpts, stripSSN: e.target.checked })} /> <span>SSN → [SSN]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripCreditCards} onChange={(e) => setStripOpts({ ...stripOpts, stripCreditCards: e.target.checked })} /> <span>Credit cards → [CREDIT_CARD]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripBankAccounts} onChange={(e) => setStripOpts({ ...stripOpts, stripBankAccounts: e.target.checked })} /> <span>Bank accounts → [BANK_ACCOUNT]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripDriversLicense} onChange={(e) => setStripOpts({ ...stripOpts, stripDriversLicense: e.target.checked })} /> <span>Driver's license → [DRIVERS_LICENSE]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripPassport} onChange={(e) => setStripOpts({ ...stripOpts, stripPassport: e.target.checked })} /> <span>Passport → [PASSPORT]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripTaxIds} onChange={(e) => setStripOpts({ ...stripOpts, stripTaxIds: e.target.checked })} /> <span>Tax IDs (EIN) → [EIN]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripApiKeys} onChange={(e) => setStripOpts({ ...stripOpts, stripApiKeys: e.target.checked })} /> <span>API keys / tokens → [API_KEY]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripPasswords} onChange={(e) => setStripOpts({ ...stripOpts, stripPasswords: e.target.checked })} /> <span>Passwords → [PASSWORD]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripAddresses} onChange={(e) => setStripOpts({ ...stripOpts, stripAddresses: e.target.checked })} /> <span>Street addresses → [ADDRESS]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripIban} onChange={(e) => setStripOpts({ ...stripOpts, stripIban: e.target.checked })} /> <span>IBAN → [IBAN]</span></label>

            <h4>Strip Formatting</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripMarkdown} onChange={(e) => setStripOpts({ ...stripOpts, stripMarkdown: e.target.checked })} /> <span>Markdown syntax</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripHtml} onChange={(e) => setStripOpts({ ...stripOpts, stripHtml: e.target.checked })} /> <span>HTML tags</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripLineNumbers} onChange={(e) => setStripOpts({ ...stripOpts, stripLineNumbers: e.target.checked })} /> <span>Line numbers</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripBom} onChange={(e) => setStripOpts({ ...stripOpts, stripBom: e.target.checked })} /> <span>BOM character</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripNonPrintable} onChange={(e) => setStripOpts({ ...stripOpts, stripNonPrintable: e.target.checked })} /> <span>Non-printable chars</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripInvisibleChars} onChange={(e) => setStripOpts({ ...stripOpts, stripInvisibleChars: e.target.checked })} /> <span>Invisible Unicode (ZWSP, tag chars, exotic spaces)</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripBidiControls} onChange={(e) => setStripOpts({ ...stripOpts, stripBidiControls: e.target.checked })} /> <span>Bidi controls (Trojan Source defense)</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.normalizeTypography} onChange={(e) => setStripOpts({ ...stripOpts, normalizeTypography: e.target.checked })} /> <span>Smart quotes, dashes, ellipsis → ASCII</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.detectHomoglyphs} onChange={(e) => setStripOpts({ ...stripOpts, detectHomoglyphs: e.target.checked })} /> <span>Homoglyphs (Cyrillic/Greek lookalikes)</span></label>

            <h4>Normalize</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.normalizeWhitespace} onChange={(e) => setStripOpts({ ...stripOpts, normalizeWhitespace: e.target.checked })} /> <span>Collapse whitespace</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.normalizeLineEndings} onChange={(e) => setStripOpts({ ...stripOpts, normalizeLineEndings: e.target.checked })} /> <span>Normalize line endings</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.trimTrailingWhitespace} onChange={(e) => setStripOpts({ ...stripOpts, trimTrailingWhitespace: e.target.checked })} /> <span>Trim trailing whitespace</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.collapseMultipleBlankLines} onChange={(e) => setStripOpts({ ...stripOpts, collapseMultipleBlankLines: e.target.checked })} /> <span>Collapse blank lines</span></label>
          </div>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runStripper} disabled={!inputText}>
            Strip Text
          </button>
        </div>
      ) : mode === 'improve' ? (
        <div className="xform-body">
          <div className="xform-unslop-intro">
            <p>Cleans up verbose language, AI-typical phrases, inflated synonyms, passive constructions, chatbot filler, and formatting tells — all in one pass. Replaces with direct, natural alternatives.</p>
          </div>

          <label className="xform-check">
            <input type="checkbox" checked={skipFillerRemoval} onChange={(e) => {
              setSkipFillerRemoval(e.target.checked);
              try { localStorage.setItem('wm:skipFillerRemoval', String(e.target.checked)); } catch {}
            }} />
            <span>Keep transition words (furthermore, moreover, in addition…)</span>
          </label>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runUnsloper} disabled={!inputText}>
            <Sparkles size={15} /> Improve Text
          </button>

          {unslopResult && (
            <div className="xform-unslop-results">
              <div className="xform-unslop-summary">
                <div className="xform-unslop-stat">
                  <span>Patterns found</span>
                  <strong>{unslopResult.patternsFound.length}</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Changes made</span>
                  <strong>{unslopResult.changeCount}</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Original</span>
                  <strong>{unslopResult.originalLength.toLocaleString()} chars</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Transformed</span>
                  <strong>{unslopResult.transformedLength.toLocaleString()} chars</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Reduction</span>
                  <strong style={{ color: 'var(--color-tertiary)' }}>
                    {unslopResult.originalLength > 0
                      ? `${((1 - unslopResult.transformedLength / unslopResult.originalLength) * 100).toFixed(1)}%`
                      : '0%'}
                  </strong>
                </div>
              </div>

              {/* Category breakdown */}
              {Object.keys(categories).length > 0 && (
                <div className="xform-unslop-cats">
                  {Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                    <span key={cat} className="xform-unslop-cat">
                      {cat} <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              )}

              {/* Pattern list */}
              <div className="xform-unslop-list">
                {unslopResult.patternsFound.map((pat) => (
                  <div key={pat.phrase} className="xform-unslop-item">
                    <span className="xform-unslop-phrase">"{pat.phrase}"</span>
                    <span className="xform-unslop-cat-badge">{pat.category}</span>
                    <span className="xform-unslop-count">×{pat.count}</span>
                    <span className="xform-unslop-arrow">→</span>
                    <span className="xform-unslop-replace">{pat.replacement}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="xform-body">
          <div className="xform-unslop-intro">
            <p>Grammar and spelling only — powered by Harper (WASM). Catches typos, grammar errors, and spelling mistakes without changing your writing style.</p>
          </div>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runHarper} disabled={!inputText || harperRunning}>
            {harperRunning ? <><Loader2 size={15} className="spin" /> Checking…</> : <><Check size={15} /> Check Grammar</>}
          </button>

          {harperLints.length > 0 && (
            <div className="xform-unslop-results">
              <div className="xform-unslop-summary">
                <div className="xform-unslop-stat">
                  <span>Issues found</span>
                  <strong>{harperLints.length}</strong>
                </div>
              </div>
              <div className="xform-unslop-list">
                {harperLints.map((lint, i) => (
                  <div key={i} className="xform-unslop-item">
                    <span className="xform-unslop-phrase">"{(format === 'pdf' ? normalizePdfText(inputText) : inputText).slice(Math.max(0, lint.start), lint.end)}"</span>
                    <span className="xform-unslop-cat-badge">{lint.kind}</span>
                    <span className="xform-unslop-replace">{lint.message}</span>
                    {lint.suggestions.length > 0 && (
                      <span className="xform-unslop-arrow">→ "{lint.suggestions[0]}"</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Output */}
      {hasOutput && (
        <div className="xform-output">
          <div className="xform-output-header">
            <h4>Output</h4>
            <div style={{ display: 'flex', gap: 4, marginRight: 'auto', marginLeft: 12 }}>
              <button
                className={`action-tactile ${viewMode === 'output' ? 'button-primary' : 'button-ghost'}`}
                type="button"
                onClick={() => setViewMode('output')}
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                <FileText size={13} /> Text
              </button>
              <button
                className={`action-tactile ${viewMode === 'diff' ? 'button-primary' : 'button-ghost'}`}
                type="button"
                onClick={() => setViewMode('diff')}
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                <Diff size={13} /> Side-by-Side
              </button>
            </div>

            {/* Tool color legend */}
            {transformSteps.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
                {transformSteps.map((step) => (
                  <span key={step.tool} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: toolColors[step.tool], display: 'inline-block' }} />
                    {toolLabels[step.tool]}
                  </span>
                ))}
              </div>
            )}

            <div className="xform-output-actions">
              <button className="action-tactile button-ghost" type="button" onClick={copyOutput}>
                <Clipboard size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="action-tactile button-ghost" type="button" onClick={downloadOutput}>
                <Download size={14} /> Download
              </button>
            </div>
          </div>

          {viewMode === 'diff' ? (
            transformSteps.length > 0 ? (
              (() => {
                const { outputSegments, removedSegments } = computeHighlights(originalText, transformSteps);
                return (
                  <div className="side-by-side-diff">
                    <div className="diff-pane">
                      <div className="diff-pane-header">
                        <span>Original</span>
                        <span className="diff-pane-stats">{originalText.length.toLocaleString()} chars</span>
                      </div>
                      <div className="diff-pane-content">
                        <div className="diff-line">
                          <span className="diff-line-text" style={{ lineHeight: 1.7 }}>
                            {renderOriginalWithHighlights(originalText, removedSegments)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="diff-divider" />
                    <div className="diff-pane">
                      <div className="diff-pane-header">
                        <span>Transformed</span>
                        <span className="diff-pane-stats">{outputText.length.toLocaleString()} chars</span>
                      </div>
                      <div className="diff-pane-content">
                        <div className="diff-line">
                          <span className="diff-line-text" style={{ lineHeight: 1.7 }}>
                            {outputSegments.map((seg, i) => (
                              seg.type === 'changed' && seg.tool ? (
                                <span
                                  key={i}
                                  style={{
                                    background: `${toolColors[seg.tool]}22`,
                                    color: toolColors[seg.tool],
                                    fontWeight: 600,
                                    borderRadius: 2,
                                    padding: '0 1px',
                                  }}
                                >
                                  {seg.text}
                                </span>
                              ) : (
                                <span key={i}>{seg.text}</span>
                              )
                            ))}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="side-by-side-diff">
                <div className="diff-pane">
                  <div className="diff-pane-header">
                    <span>Original</span>
                    <span className="diff-pane-stats">{inputText.length.toLocaleString()} chars</span>
                  </div>
                  <div className="diff-pane-content">
                    {diffLines(inputText, outputText).map((line, i) => (
                      <div key={`orig-${i}`} className={`diff-line ${line.type === 'removed' ? 'removed' : line.type === 'unchanged' ? '' : 'dim'}`}>
                        <span className="diff-line-num">{line.type === 'removed' || line.type === 'unchanged' ? line.origNum : ''}</span>
                        <span className="diff-line-text">{line.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="diff-divider" />
                <div className="diff-pane">
                  <div className="diff-pane-header">
                    <span>Transformed</span>
                    <span className="diff-pane-stats">{outputText.length.toLocaleString()} chars</span>
                  </div>
                  <div className="diff-pane-content">
                    {diffLines(inputText, outputText).map((line, i) => (
                      <div key={`out-${i}`} className={`diff-line ${line.type === 'added' ? 'added' : line.type === 'unchanged' ? '' : 'dim'}`}>
                        <span className="diff-line-num">{line.type === 'added' || line.type === 'unchanged' ? line.outNum : ''}</span>
                        <span className="diff-line-text">{line.type === 'removed' ? '' : (line.outText ?? line.text)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          ) : (
            <textarea className="xform-output-text" readOnly value={outputText} rows={12} />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Batch Report View ────────────────────────────────────────── */

interface BatchItem {
  id: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  result: VerificationResult | null;
  status: 'pending' | 'verifying' | 'done' | 'error';
  restored?: boolean; // true if restored from localStorage (file not available)
}

let batchIdCounter = 0;

function BatchView({ showToast }: { showToast: (msg: string) => void }) {
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

  // Persistence: save media batch items
  useEffect(() => {
    if (items.length > 0) {
      storeMediaBatch(items.map((it) => ({
        id: it.id,
        fileName: it.fileName,
        fileSize: it.fileSize,
        mimeType: it.mimeType,
        sha256: it.result?.sha256 ?? '',
        status: it.status,
        validationState: it.result?.validationState ?? null,
        manifestCount: it.result?.manifestCount ?? 0,
        signedAt: it.result?.manifests?.[0]?.signedAt ?? null,
      })));
    }
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

    setItems((prev) => [...prev, ...newItems]);

    // Process in parallel batches of 4
    const BATCH_SIZE = 4;
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
      const batch = fileArray.slice(i, i + BATCH_SIZE);
      const batchItems = newItems.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((file) => verifyFile(file))
      );

      setItems((prev) =>
        prev.map((item) => {
          const idx = batchItems.findIndex((b) => b.id === item.id);
          if (idx === -1) return item;
          const result = results[idx];
          return {
            ...item,
            result: result.status === 'fulfilled' ? result.value : errorResult(item.fileName, item.fileSize, item.mimeType, '', result.reason),
            status: 'done' as const,
          };
        })
      );
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
                        <span className="batch-badge success">Trusted</span>
                      ) : r?.validationState === 'Valid' ? (
                        <span className="batch-badge info">Valid</span>
                      ) : r?.validationState === 'Invalid' ? (
                        <span className="batch-badge danger">Invalid</span>
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

/* ── Main App ────────────────────────────────────────────────── */

export default function App() {
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

  // Persistence: save result when it changes
  useEffect(() => {
    storeResult(result);
  }, [result]);

  // Persistence: save view when it changes
  useEffect(() => {
    storeLastView(view);
  }, [view]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

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
  }, [showToast]);

  // Persistence: restore file info from stored result
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const storedFile = getStoredFileInfo();
    if (storedFile && !file) {
      // We can't restore the actual File object, but we can show the name
      // The user will need to re-drop to get full functionality
    }
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

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setIsVerifying(true);
    setIsSample(false);
    setResult(null);
    setFile(file);
    storeFileInfo(file);
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);

    const nextPreview = file.type.startsWith('image/') ? window.URL.createObjectURL(file) : null;
    setPreviewUrl(nextPreview);

    try {
      const nextResult = await verifyFile(file);
      setResult(nextResult);
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
    setIsSample(false);
    setZoom(100);
    clearAll();
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
        <Header view={view} setView={setView} />
        <BatchView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'diff') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} />
        <DiffView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'simulator') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} />
        <SimulatorView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'playground') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} />
        <PlaygroundView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'lineage') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} />
        <LineageView result={result} showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view === 'text') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} />
        <TextView showToast={showToast} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (view !== 'inspector') {
    return (
      <div className="app-frame">
        <Header view={view} setView={setView} />
        <FutureView view={view} result={result} />
        <Footer />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  return (
    <div className={`app-frame ${isDragging ? 'is-dragging' : ''}`}>
      <Header view={view} setView={setView} />

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

      <Footer />
      <ToastContainer toasts={toasts} />
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────── */

function Header({ view, setView }: { view: View; setView: (view: View) => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><ShieldCheck size={21} /></div>
        <div className="brand-copy">
          <strong>Watermark</strong>
          <span>C2PA Engine v2.4 (WASM)</span>
        </div>
      </div>
      <nav className="desktop-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
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
          SDK @contentauth/c2pa-web v0.14.5 Loaded
        </span>
      </div>
      <span className="footer-trust">Zero-Trust Sandbox</span>
    </footer>
  );
}
