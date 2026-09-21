import { useState, useEffect } from 'react';
import { Eye, Pencil, Download, ShieldCheck } from 'lucide-react';
import type { FileMetadata } from '../../lib/metadata';
import { extractFileMetadata, sanitizeMetadata, applyMetadataEdit, SANITIZE_PRESETS } from '../../lib/metadata';
import type { ManifestSummary, ValidationCode, VerificationStatus } from '../../lib/types';
import { BinaryInspector, HashCalculatorPanel } from './';

export function MetadataTab({ file, sha256 }: { file: File | null; sha256: string }) {
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
    setSanitizedMeta({ ...metadata, sections: result.sections });
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
          <button
            className={`tab-btn ${activeSection === 'hashes' ? 'active' : ''}`}
            type="button"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setActiveSection('hashes')}
          >
            Hash Calculator
          </button>
        </div>

        {/* Content */}
        <div style={{ marginTop: 12 }}>
          {activeSection === 'hex' ? (
            <BinaryInspector binary={metadata.binary} />
          ) : activeSection === 'hashes' ? (
            <HashCalculatorPanel file={file} />
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

export function ManifestCard({ manifest }: { manifest: ManifestSummary }) {
  return (
    <div className="manifest-card">
      <div className="manifest-card-header">
        <span className="manifest-label">{manifest.label}</span>
        {manifest.isActive && <span className="manifest-badge active">Active</span>}
      </div>
      <div className="manifest-card-body">
        {manifest.claimGenerator && <div className="manifest-field"><span className="manifest-key">Generator</span><span className="manifest-value">{manifest.claimGenerator}</span></div>}
        {manifest.issuer && <div className="manifest-field"><span className="manifest-key">Issuer</span><span className="manifest-value">{manifest.issuer}</span></div>}
        {manifest.signedAt && <div className="manifest-field"><span className="manifest-key">Signed</span><span className="manifest-value">{manifest.signedAt}</span></div>}
        {manifest.signatureAlgorithm && <div className="manifest-field"><span className="manifest-key">Algorithm</span><span className="manifest-value">{manifest.signatureAlgorithm}</span></div>}
      </div>
    </div>
  );
}

export function CryptoCheck({ label, value, passed }: { label: string; value: string; passed?: boolean }) {
  return (
    <div className="crypto-check">
      <span className="crypto-check-icon">
        {passed === true ? '✓' : passed === false ? '✗' : '—'}
      </span>
      <span className="crypto-check-label">{label}</span>
      <span className="crypto-check-value">{value}</span>
    </div>
  );
}

export function EmptyInspector() {
  return (
    <div className="inspector-tab-content">
      <div className="panel empty-panel">
        <p>No file selected. Drop an image, video, or document to begin inspection.</p>
      </div>
    </div>
  );
}
