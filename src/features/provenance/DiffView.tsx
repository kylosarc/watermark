import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { verifyFile } from '../../lib/c2pa';
import { errorResult } from '../../lib/verification';
import { formatBytes } from '../../lib/file';
import { storeDiffSlotA, getStoredDiffSlotA } from '../../lib/persist';
import type { VerificationResult, ValidationState } from '../../lib/types';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*';

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

export function DiffView({ showToast }: { showToast: (msg: string) => void }) {
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
