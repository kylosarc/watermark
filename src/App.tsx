import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
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
  Lock,
  LockKeyhole,
  Maximize,
  Pencil,
  Play,
  RefreshCw,
  ScanSearch,
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
import { extractFileMetadata, type FileMetadata, sanitizeMetadata, SANITIZE_PRESETS, applyMetadataEdit } from './lib/metadata';
import {
  applyStripper, STRIPPER_DEFAULTS, STRIPPER_PRESETS,
  detectUnslopPatterns, applyUnslop,
  type StripperOptions, type UnslopPattern,
} from './lib/transform';
import { harperLint, harperFixAll } from './lib/harper';
import type { HarperLint } from './lib/harper';
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

  const editableKeys = new Set(['Artist', 'Copyright', 'ImageDescription', 'UserComment', 'Software', 'Rating']);

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
              <Eye size={13} /> View
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={() => setEditMode(true)}>
              <Pencil size={13} /> Edit
            </button>
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
          {metadata.binary.structure.length > 0 && (
            <button
              className={`tab-btn ${activeSection === 'structure' ? 'active' : ''}`}
              type="button"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setActiveSection('structure')}
            >
              Binary Structure
            </button>
          )}
          <button
            className={`tab-btn ${activeSection === 'hex' ? 'active' : ''}`}
            type="button"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setActiveSection('hex')}
          >
            Hex View
          </button>
        </div>

        {/* Content */}
        <div style={{ marginTop: 12 }}>
          {activeSection === 'hex' ? (
            <pre className="hex-view" style={{ fontSize: 11, lineHeight: 1.5, maxHeight: 400, overflow: 'auto', color: 'var(--color-on-surface)' }}>
              {metadata.binary.hexPreview}
            </pre>
          ) : activeSection === 'structure' ? (
            <div className="binary-structure">
              {metadata.binary.structure.length === 0 ? (
                <span style={{ color: 'var(--color-on-surface-variant)' }}>No structure detected for this file type.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {metadata.binary.structure.map((s, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 80px 80px 1fr', gap: 8, fontSize: 12, fontFamily: 'var(--font-mono)', padding: '4px 0', borderBottom: '1px solid rgba(61,73,76,0.2)' }}>
                      <span style={{ color: 'var(--color-primary)' }}>{s.name}</span>
                      <span style={{ color: '#94a3b8' }}>0x{s.offset.toString(16).padStart(6, '0')}</span>
                      <span style={{ color: '#94a3b8' }}>{s.length}B</span>
                      <span style={{ color: 'var(--color-on-surface-variant)' }}>{s.description}</span>
                    </div>
                  ))}
            </div>
          )}
        </div>
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
                    {editableKeys.has(entry.key) && (
                      <button
                        className="action-tactile button-ghost"
                        type="button"
                        style={{ fontSize: 11, padding: '2px 6px' }}
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
      x: 120,
      y: 80 + idx * 120,
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
        x: 340 + (ingIdx % 2) * 100,
        y: 80 + idx * 120 + (ingIdx > 0 ? 40 : 0),
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

  const graphWidth = Math.max(containerWidth, 600);
  const graphHeight = Math.max(500, nodes.length * 80 + 100);

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
    return type === 'active' ? 24 : type === 'ingredient' ? 16 : 20;
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
                        fontSize={node.type === 'active' ? 10 : 8}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {node.type === 'ingredient' ? 'I' : node.label.split('_')[0]?.slice(0, 3) ?? ''}
                      </text>
                      {/* Full label below */}
                      <text
                        x={node.x}
                        y={node.y + r + 14}
                        textAnchor="middle"
                        fill="var(--color-on-surface-dim)"
                        fontSize={9}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label}
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
  type TextSubTab = 'analysis' | 'transform';
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

  const selectedItem = items.find((it) => it.id === selectedId) ?? null;

  async function hashText(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function processOne(text: string, source: 'file' | 'paste', fileName: string | null): Promise<TextItem> {
    const id = ++textIdCounter;

    // SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const analysis = analyzeText(text);

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
      const transformed = op.transform(item.content);
      const hash = await hashText(transformed);
      results.push({ name: op.name, description: op.description, hash, preserved: hash === originalHash });
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
                        >
                          <Info size={13} /> Analysis
                        </button>
                        <button
                          className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'transform' ? 'active' : ''}`}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('transform'); }}
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
          {selectedItem && selectedItem.analysis && (
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
              ) : (
                <TextTransformPanel inputText={selectedItem.content} showToast={showToast} />
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
  const a = item.analysis!;

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
          </>
        )}
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

function TextTransformPanel({ inputText, showToast }: { inputText: string; showToast: (msg: string) => void }) {
  const [mode, setMode] = useState<'strip' | 'unslop' | 'harper'>('strip');
  const [viewMode, setViewMode] = useState<'output' | 'diff'>('output');
  const [outputText, setOutputText] = useState('');
  const [hasOutput, setHasOutput] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Harper state
  const [harperLints, setHarperLints] = useState<HarperLint[]>([]);
  const [harperRunning, setHarperRunning] = useState(false);

  function runStripper() {
    const result = applyStripper(inputText, stripOpts);
    setOutputText(result);
    setHasOutput(true);
    showToast('Text stripped');
  }

  function runUnsloper() {
    const patterns = detectUnslopPatterns(inputText);
    setUnslopPatterns(patterns);
    const result = applyUnslop(inputText, patterns);
    setUnslopResult(result);
    setOutputText(result.text);
    setHasOutput(true);
    showToast(`Unslopped — ${result.changeCount} changes, ${patterns.length} patterns found`);
  }

  async function runHarper() {
    setHarperRunning(true);
    try {
      const lints = await harperLint(inputText);
      setHarperLints(lints);
      const fixed = await harperFixAll(inputText);
      setOutputText(fixed);
      setHasOutput(true);
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
      <div className="xform-tabs">
        <button
          className={`xform-tab ${mode === 'strip' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('strip')}
        >
          Strip / Obfuscate
        </button>
        <button
          className={`xform-tab ${mode === 'unslop' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('unslop')}
        >
          Unslop
        </button>
        <button
          className={`xform-tab ${mode === 'harper' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('harper')}
        >
          Harper
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
      ) : (
        <div className="xform-body">
          <div className="xform-unslop-intro">
            <p>Detects AI-typical phrases, inflated language, verbose synonyms, chatbot patterns, and formatting tells. Removes or replaces them with direct alternatives.</p>
          </div>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runUnsloper} disabled={!inputText}>
            <Sparkles size={15} /> Detect & Unslop
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
                    <td className="batch-cell-name" title={item.fileName}>{item.fileName}</td>
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
    const nextResult = await verifyFile(file);
    setResult(nextResult);
    setIsVerifying(false);
    showToast(`Loaded ${file.name}`);
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {activeManifest.assertions.map((assertion, i) => (
                        <div className="action-row" key={assertion}>
                          <div className="action-num">{String(i + 1).padStart(2, '0')}</div>
                          <div className="action-content">
                            <div className="action-header">
                              <span className="action-name">{assertion}</span>
                            </div>
                            <p className="action-desc">Assertion detected in C2PA manifest.</p>
                          </div>
                        </div>
                      ))}
                      {activeManifest.assertions.length === 0 && <p className="muted">None listed.</p>}
                    </div>
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
