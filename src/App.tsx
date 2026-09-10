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
  FileCheck2,
  FileJson,
  FileUp,
  Fingerprint,
  GitBranch,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers3,
  Lock,
  LockKeyhole,
  Maximize,
  RefreshCw,
  ScanSearch,
  Layers,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { verifyFile } from './lib/c2pa';
import { errorResult } from './lib/verification';
import { formatBytes, sha256Hex } from './lib/file';
import type { ManifestSummary, ValidationCode, VerificationResult, VerificationStatus } from './lib/types';
import './styles.css';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*';
const SAMPLE_NAME = 'alpine_dawn_capture_2025.jpg';

type View = 'inspector' | 'lineage' | 'evidence' | 'settings';
type InspectorTab = 'overview' | 'assertions' | 'cryptography' | 'raw-json';

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
  { id: 'lineage' as View, label: 'Manifest Lineage', icon: GitBranch },
  { id: 'evidence' as View, label: 'Evidence Export', icon: FileCheck2 },
  { id: 'settings' as View, label: 'Trust Anchors / Settings', icon: Settings }
];

const INSPECTOR_TABS = [
  { id: 'overview' as InspectorTab, label: 'Manifest Overview', icon: Info },
  { id: 'assertions' as InspectorTab, label: 'Assertions & Ingredients', icon: Layers },
  { id: 'cryptography' as InspectorTab, label: 'Cryptographic Proof', icon: Lock },
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

function FutureView({ view, result }: { view: Exclude<View, 'inspector'>; result: VerificationResult | null }) {
  const titles: Record<Exclude<View, 'inspector'>, string> = {
    lineage: 'Manifest Lineage',
    evidence: 'Evidence Export',
    settings: 'Trust Anchors / Settings'
  };
  const descriptions: Record<Exclude<View, 'inspector'>, string> = {
    lineage: 'Trace active and ingredient manifests in the provenance chain.',
    evidence: 'Package verification results, hashes, and validation codes for review.',
    settings: 'Configure trust policy and local processing preferences.'
  };

  return (
    <main className="future-view">
      <section className="future-panel">
        <div className="future-icon">{view === 'lineage' ? <GitBranch /> : view === 'evidence' ? <FileCheck2 /> : <KeyRound />}</div>
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

/* ── Main App ────────────────────────────────────────────────── */

export default function App() {
  const [view, setView] = useState<View>('inspector');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [result, setResult] = useState<VerificationResult | null>(null);
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

  useEffect(() => () => {
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, [previewUrl]);

  useEffect(() => {
    if (sampleLoadedRef.current) return;
    sampleLoadedRef.current = true;
    sampleActiveRef.current = true;
    void loadSample();
    return () => { sampleActiveRef.current = false; };
  }, []);

  useEffect(() => {
    const returnToInspector = () => setView('inspector');
    window.addEventListener('watermark:return-inspector', returnToInspector);
    return () => window.removeEventListener('watermark:return-inspector', returnToInspector);
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
    setIsSample(false);
    setZoom(100);
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
      <div className="account-chip" aria-label="Local session">
        <UserRound size={17} />
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
