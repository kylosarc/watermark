import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { verifyFile } from '../../lib/c2pa';
import { formatBytes } from '../../lib/file';

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

export function SimulatorView({ showToast }: { showToast: (msg: string) => void }) {
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

      {/* What-If Scenario Builder */}
      <div style={{ marginTop: 20, padding: 16, background: 'var(--color-surface)', borderRadius: 8, border: '1px solid rgba(61,73,76,0.3)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>What-If Scenario Builder</h3>
        <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 12 }}>
          Simulate real-world scenarios to see if your content credentials survive common workflows.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {[
            { scenario: 'Screenshot on phone', willBreak: true, reason: 'Screen capture strips all metadata and re-encodes pixels' },
            { scenario: 'Upload to Instagram', willBreak: true, reason: 'Server-side re-encode strips EXIF/XMP/C2PA' },
            { scenario: 'Upload to Twitter/X', willBreak: true, reason: 'Server-side re-encode strips metadata' },
            { scenario: 'Email as attachment', willBreak: false, reason: 'Attachment preserved as-is (if not re-encoded by client)' },
            { scenario: 'Download from Google Drive', willBreak: false, reason: 'Files served as-is (unless preview mode re-encodes)' },
            { scenario: 'Print to PDF', willBreak: true, reason: 'PDF re-render strips source metadata' },
            { scenario: 'Copy-paste in browser', willBreak: true, reason: 'Clipboard only carries pixel data, no metadata' },
            { scenario: 'AirDrop to Mac', willBreak: false, reason: 'File transfer preserves bytes (if not previewed)' },
            { scenario: 'Save As from browser', willBreak: false, reason: 'Original file bytes preserved' },
            { scenario: 'Crop in photo editor', willBreak: true, reason: 'Re-encode invalidates content binding hash' },
          ].map((s) => (
            <div key={s.scenario} style={{ padding: 10, borderRadius: 6, background: s.willBreak ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)', border: `1px solid ${s.willBreak ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {s.willBreak ? <AlertTriangle size={14} style={{ color: '#ef4444' }} /> : <CheckCircle2 size={14} style={{ color: '#22c55e' }} />}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-on-surface)' }}>{s.scenario}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>{s.reason}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: s.willBreak ? '#ef4444' : '#22c55e', marginTop: 4 }}>
                {s.willBreak ? 'Credentials: BROKEN' : 'Credentials: PRESERVED'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Watermark Survival Matrix */}
      <div style={{ marginTop: 16, padding: 16, background: 'var(--color-surface)', borderRadius: 8, border: '1px solid rgba(61,73,76,0.3)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Watermark Survival Matrix</h3>
        <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 12 }}>
          Which watermark types survive which operations. Soft binding can recover provenance even after hard metadata is stripped.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(61,73,76,0.3)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--color-muted)' }}>Operation</th>
                <th style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--color-primary)' }}>C2PA Manifest</th>
                <th style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--color-secondary)' }}>EXIF/XMP</th>
                <th style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--color-tertiary)' }}>Soft Binding</th>
                <th style={{ textAlign: 'center', padding: '6px 6px', color: '#f59e0b' }}>SynthID</th>
                <th style={{ textAlign: 'center', padding: '6px 6px', color: '#f87171' }}>Stable Sig</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Screenshot', '❌', '❌', '⚠️ Possible', '✅ Likely', '❌'],
                ['Re-encode (JPEG)', '❌', '❌', '⚠️ Possible', '✅ Likely', '❌'],
                ['Crop + Re-save', '❌', '❌', '⚠️ Possible', '✅ Likely', '❌'],
                ['Social Upload', '❌', '❌', '❌', '⚠️ May survive', '❌'],
                ['Print → Scan', '❌', '❌', '❌', '❌', '❌'],
                ['Email Attachment', '✅', '✅', '✅', '✅', '✅'],
                ['File Transfer', '✅', '✅', '✅', '✅', '✅'],
                ['Cloud Backup', '✅', '✅', '✅', '✅', '✅'],
                ['Lossless Metadata Strip', '❌', '❌', '✅', '✅', '✅'],
                ['Format Convert (PNG→JPEG)', '❌', '❌', '⚠️ Possible', '✅ Likely', '❌'],
              ].map(([op, c2pa, exif, soft, synth, stable]) => (
                <tr key={op} style={{ borderBottom: '1px solid rgba(61,73,76,0.15)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--color-on-surface)', whiteSpace: 'nowrap' }}>{op}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{c2pa}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{exif}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{soft}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{synth}</td>
                  <td style={{ textAlign: 'center', padding: '5px 6px' }}>{stable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <canvas ref={canvasRef} className="visually-hidden" />
    </main>
  );
}
