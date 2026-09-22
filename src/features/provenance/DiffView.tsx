import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, FileText, GitBranch, Link2, RefreshCw, Shield, ShieldOff, Trash2, Upload } from 'lucide-react';
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
  aSha256: string;
  bSha256: string;
  aActiveManifest: string;
  bActiveManifest: string;
  summary: string;
  keyFindings: KeyFinding[];
}

interface KeyFinding {
  icon: 'binding' | 'manifest' | 'metadata' | 'relation' | 'generator';
  label: string;
  status: 'valid' | 'invalid' | 'changed' | 'unchanged' | 'unknown';
  detail: string;
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

  // Generate plain-English summary
  const summary = generateSummary(a, b, assertionDiff, ingredientDiff, bindingHolds, distance);

  // Generate key findings
  const keyFindings = generateKeyFindings(a, b, assertionDiff, ingredientDiff, bindingHolds, aManifest, bManifest);

  return {
    assertionDiff,
    ingredientDiff,
    bindingHolds,
    distance,
    aManifestCount: a.manifestCount,
    bManifestCount: b.manifestCount,
    aValidationState: a.validationState,
    bValidationState: b.validationState,
    aSha256: a.sha256,
    bSha256: b.sha256,
    aActiveManifest: a.activeManifest ?? aManifest?.label ?? 'None',
    bActiveManifest: b.activeManifest ?? bManifest?.label ?? 'None',
    summary,
    keyFindings,
  };
}

function generateSummary(
  a: VerificationResult,
  b: VerificationResult,
  assertionDiff: DiffAssertion[],
  ingredientDiff: DiffIngredient[],
  bindingHolds: boolean,
  distance: number,
): string {
  const parts: string[] = [];

  // Relationship assessment
  if (distance <= 10) {
    parts.push('These files appear to be identical in provenance.');
  } else if (distance <= 25) {
    parts.push('File B appears closely related to File A with minor provenance differences.');
  } else if (distance <= 50) {
    parts.push('File B appears to be derived from File A with moderate provenance changes.');
  } else if (distance <= 75) {
    parts.push('File B shows significant provenance divergence from File A.');
  } else {
    parts.push('File B has a substantially different provenance from File A.');
  }

  // Assertion changes
  const removed = assertionDiff.filter((d) => d.inA && !d.inB);
  const added = assertionDiff.filter((d) => !d.inA && d.inB);
  if (removed.length > 0) {
    const labels = removed.map((d) => d.label).join(', ');
    parts.push(`Metadata removed: ${labels}.`);
  }
  if (added.length > 0) {
    const labels = added.map((d) => d.label).join(', ');
    parts.push(`New metadata added: ${labels}.`);
  }

  // Ingredient changes
  const removedIngredients = ingredientDiff.filter((d) => d.inA && !d.inB);
  const addedIngredients = ingredientDiff.filter((d) => !d.inA && d.inB);
  if (removedIngredients.length > 0) {
    parts.push('Some source ingredients were removed from the ingredient chain.');
  }
  if (addedIngredients.length > 0) {
    parts.push('New ingredients were added to the chain.');
  }

  // Binding status
  if (!bindingHolds) {
    parts.push('The original C2PA content binding no longer validates.');
  } else {
    parts.push('Content binding remains intact between both files.');
  }

  return parts.join(' ');
}

function generateKeyFindings(
  a: VerificationResult,
  b: VerificationResult,
  assertionDiff: DiffAssertion[],
  ingredientDiff: DiffIngredient[],
  bindingHolds: boolean,
  aManifest: any,
  bManifest: any,
): KeyFinding[] {
  const findings: KeyFinding[] = [];

  // Finding 1: Content binding status
  findings.push({
    icon: 'binding',
    label: 'Content Binding',
    status: bindingHolds ? 'valid' : 'invalid',
    detail: bindingHolds
      ? 'Both files have valid signatures and the content chain is intact.'
      : 'One or both signatures are invalid — the content binding has been broken.',
  });

  // Finding 2: Manifest changes
  const manifestDiff = b.manifestCount - a.manifestCount;
  findings.push({
    icon: 'manifest',
    label: 'Manifest Changes',
    status: manifestDiff === 0 ? 'unchanged' : 'changed',
    detail: manifestDiff === 0
      ? `Both files have ${a.manifestCount} manifest(s). No manifest-level changes detected.`
      : `Side A has ${a.manifestCount} manifest(s), Side B has ${b.manifestCount} (change: ${manifestDiff > 0 ? '+' : ''}${manifestDiff}).`,
  });

  // Finding 3: Metadata changes
  const removedMeta = assertionDiff.filter((d) => d.inA && !d.inB);
  const addedMeta = assertionDiff.filter((d) => !d.inA && d.inB);
  const metaStatus = removedMeta.length > 0 && addedMeta.length > 0
    ? 'changed'
    : removedMeta.length > 0 || addedMeta.length > 0
      ? 'changed'
      : 'unchanged';
  findings.push({
    icon: 'metadata',
    label: 'Metadata Changes',
    status: metaStatus,
    detail: metaStatus === 'unchanged'
      ? 'All assertions are preserved across both files.'
      : `${removedMeta.length} assertion(s) removed, ${addedMeta.length} assertion(s) added.`,
  });

  // Finding 4: Ingredient chain relation
  const sharedIngredients = ingredientDiff.filter((d) => d.inA && d.inB).length;
  const totalUniqueIngredients = ingredientDiff.length;
  const relatedness = totalUniqueIngredients > 0
    ? Math.round((sharedIngredients / totalUniqueIngredients) * 100)
    : 100;
  findings.push({
    icon: 'relation',
    label: 'Ingredient Chain',
    status: relatedness >= 50 ? 'valid' : relatedness > 0 ? 'changed' : 'unknown',
    detail: relatedness >= 50
      ? `Files share ${relatedness}% of ingredients — likely derived from the same source.`
      : relatedness > 0
        ? `Files share only ${relatedness}% of ingredients — weak relationship.`
        : 'No shared ingredients found — files may be unrelated.',
  });

  // Finding 5: Claim generator
  const sameGenerator = aManifest?.claimGenerator === bManifest?.claimGenerator;
  findings.push({
    icon: 'generator',
    label: 'Claim Generator',
    status: sameGenerator ? 'valid' : 'changed',
    detail: sameGenerator
      ? `Both files were signed by the same generator: ${aManifest?.claimGenerator ?? 'Unknown'}.`
      : `Different generators used — Side A: ${aManifest?.claimGenerator ?? 'Unknown'}, Side B: ${bManifest?.claimGenerator ?? 'Unknown'}.`,
  });

  return findings;
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
              {slot.result?.sha256 && (
                <div className="diff-slot-hash">
                  <span className="diff-slot-hash-label">SHA-256</span>
                  <code className="diff-slot-hash-value">{slot.result.sha256}</code>
                </div>
              )}
              {slot.result && slot.result.manifestCount > 0 && (
                <div className="diff-slot-manifest-info">
                  <span className="diff-slot-manifest-count">
                    {slot.result.manifestCount} manifest{slot.result.manifestCount !== 1 ? 's' : ''}
                  </span>
                  {slot.result.activeManifest && (
                    <span className="diff-slot-active-manifest">Active: {slot.result.activeManifest}</span>
                  )}
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
          {/* Derivation Summary Card */}
          <div className="diff-summary-card">
            <div className="diff-summary-card-header">
              <Eye size={16} />
              <h3>Derivation Summary</h3>
            </div>
            <p className="diff-summary-card-text">{diff.summary}</p>
          </div>

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

          {/* Key Findings Panel */}
          <div className="diff-key-findings">
            <div className="diff-key-findings-header">
              <FileText size={16} />
              <h3>Key Findings</h3>
            </div>
            <div className="diff-key-findings-list">
              {diff.keyFindings.map((finding) => (
                <div key={finding.label} className={`diff-key-finding diff-key-finding--${finding.status}`}>
                  <div className="diff-key-finding-icon">
                    {finding.icon === 'binding' && (finding.status === 'valid' ? <Shield size={16} /> : <ShieldOff size={16} />)}
                    {finding.icon === 'manifest' && <GitBranch size={16} />}
                    {finding.icon === 'metadata' && <FileText size={16} />}
                    {finding.icon === 'relation' && <Link2 size={16} />}
                    {finding.icon === 'generator' && <RefreshCw size={16} />}
                  </div>
                  <div className="diff-key-finding-content">
                    <span className="diff-key-finding-label">{finding.label}</span>
                    <span className="diff-key-finding-detail">{finding.detail}</span>
                  </div>
                  <span className={`diff-key-finding-badge diff-key-finding-badge--${finding.status}`}>
                    {finding.status === 'valid' ? 'Valid' : finding.status === 'invalid' ? 'Invalid' : finding.status === 'changed' ? 'Changed' : finding.status === 'unchanged' ? 'Unchanged' : 'Unknown'}
                  </span>
                </div>
              ))}
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
