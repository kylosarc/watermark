import {
  Shield, Key, Tag, Package, FileText, X, ChevronRight,
  CheckCircle, AlertTriangle, HelpCircle, XCircle, Info,
} from 'lucide-react';
import type { VerificationResult } from '../../lib/types';
import type { EvidenceStatus, Finding, FindingCategory } from '../../lib/evidence';
import { STATUS_LABELS, STATUS_COLORS, STATUS_EMOJI, CATEGORY_LABELS, explainFinding } from '../../lib/evidence';

/* ── Evidence Panel Types ───────────────────────────────────── */

type NodeType = 'file' | 'manifest' | 'evidence' | 'assertions' | 'ingredients';

interface ProvenanceEvidencePanelProps {
  result: VerificationResult | null;
  selectedNodeId: string | null;
  onClose?: () => void;
}

/* ── Status helpers ─────────────────────────────────────────── */

const STATUS_ICON: Record<EvidenceStatus, React.ReactNode> = {
  verified: <CheckCircle size={14} style={{ color: STATUS_COLORS.verified }} />,
  supported: <Info size={14} style={{ color: STATUS_COLORS.supported }} />,
  claimed: <AlertTriangle size={14} style={{ color: STATUS_COLORS.claimed }} />,
  unknown: <HelpCircle size={14} style={{ color: STATUS_COLORS.unknown }} />,
  contradicted: <XCircle size={14} style={{ color: STATUS_COLORS.contradicted }} />,
  rejected: <AlertTriangle size={14} style={{ color: '#f59e0b' }} />,
  modified: <AlertTriangle size={14} style={{ color: '#a855f7' }} />,
  stripped: <XCircle size={14} style={{ color: '#f43f5e' }} />,
};

const STATUS_TEXT_COLOR: Record<EvidenceStatus, string> = {
  verified: 'var(--color-tertiary)',
  supported: 'var(--color-primary)',
  claimed: '#f59e0b',
  unknown: 'var(--color-outline)',
  contradicted: 'var(--color-error)',
  rejected: '#f59e0b',
  modified: '#a855f7',
  stripped: '#f43f5e',
};

/* ── Derive evidence findings from result ───────────────────── */

function deriveFindings(result: VerificationResult): Finding[] {
  const findings: Finding[] = [];
  const manifest = result.manifests.find((m) => m.isActive) ?? result.manifests[0];

  // Signature finding
  if (manifest) {
    const sigValid = manifest.validationCodes.length > 0 &&
      manifest.validationCodes.every((v) => v.success);
    findings.push({
      id: 'sig',
      category: 'signature',
      perspective: 'independent',
      status: sigValid ? 'verified' : result.validationState === 'Invalid' ? 'contradicted' : 'unknown',
      confidence: sigValid ? 95 : 30,
      label: 'Digital Signature',
      description: sigValid
        ? `Signature valid — signed with ${manifest.signatureAlgorithm ?? 'unknown algorithm'}`
        : 'Signature could not be verified',
      evidence: [
        { source: 'c2pa-signature', detail: manifest.signatureAlgorithm },
        ...manifest.validationCodes.map((v) => ({
          source: 'c2pa-signature' as const,
          detail: `${v.code}: ${v.explanation ?? 'no explanation'}`,
        })),
      ],
    });

    // Content binding
    findings.push({
      id: 'binding',
      category: 'content-binding',
      perspective: 'independent',
      status: result.validationState === 'Trusted' ? 'verified' : result.validationState === 'Valid' ? 'supported' : 'contradicted',
      confidence: result.validationState === 'Trusted' ? 90 : 50,
      label: 'Content Binding',
      description: `Content hash matches manifest binding — validation state: ${result.validationState}`,
      evidence: [{ source: 'c2pa-binding', detail: `SHA-256: ${result.sha256.slice(0, 16)}…` }],
    });

    // Issuer trust
    findings.push({
      id: 'issuer',
      category: 'issuer-trust',
      perspective: 'independent',
      status: manifest.issuer ? 'supported' : 'unknown',
      confidence: manifest.issuer ? 60 : 10,
      label: 'Issuer Trust',
      description: manifest.issuer
        ? `Manifest issued by ${manifest.issuer}`
        : 'No issuer information available',
      evidence: [{ source: 'c2pa-manifest', detail: manifest.issuer }],
    });

    // Assertions
    if (manifest.assertions.length > 0) {
      findings.push({
        id: 'assertions',
        category: 'provenance-chain',
      perspective: 'independent',
        status: 'claimed',
        confidence: 50,
        label: 'Assertions',
        description: `${manifest.assertions.length} assertion(s) declared in manifest`,
        evidence: manifest.assertions.map((a) => ({
          source: 'c2pa-assertion' as const,
          detail: a,
        })),
      });
    }

    // AI generation
    if (manifest.isAIGenerated !== undefined) {
      findings.push({
        id: 'ai',
        category: 'ai-generation',
      perspective: 'independent',
        status: 'claimed',
        confidence: 40,
        label: 'AI Generation',
        description: manifest.isAIGenerated
          ? `Claimed AI-generated (${manifest.digitalSourceType ?? 'unknown source'})`
          : 'Not flagged as AI-generated',
        evidence: [{ source: 'c2pa-assertion', detail: `digitalSourceType: ${manifest.digitalSourceType ?? 'n/a'}` }],
      });
    }

    // Ingredients / provenance chain
    if (manifest.ingredients.length > 0) {
      findings.push({
        id: 'ingredients',
        category: 'provenance-chain',
      perspective: 'independent',
        status: 'supported',
        confidence: 55,
        label: 'Provenance Chain',
        description: `${manifest.ingredients.length} ingredient(s) linked in provenance chain`,
        evidence: manifest.ingredients.map((ing) => ({
          source: 'c2pa-manifest' as const,
          detail: ing,
        })),
      });
    }
  } else {
    // No manifest
    findings.push({
      id: 'no-manifest',
      category: 'manifest-integrity',
      perspective: 'independent',
      status: 'contradicted',
      confidence: 0,
      label: 'No C2PA Manifest',
      description: 'File does not contain a C2PA manifest',
      evidence: [{ source: 'analysis', detail: 'No C2PA manifest detected' }],
    });
  }

  return findings;
}

/* ── Detail sections per node type ──────────────────────────── */

function FileDetails({ result }: { result: VerificationResult }) {
  return (
    <div className="identity-rows">
      <DetailRow label="File Name" value={result.fileName} />
      <DetailRow label="File Size" value={`${(result.fileSize / 1024).toFixed(1)} KB`} />
      <DetailRow label="MIME Type" value={result.mimeType} />
      <DetailRow label="SHA-256" value={result.sha256} mono />
      <DetailRow label="Validation" value={result.validationState} />
      <DetailRow label="Manifests" value={`${result.manifestCount}`} />
    </div>
  );
}

function ManifestDetails({ manifest }: { manifest: NonNullable<VerificationResult['manifests'][0]> }) {
  return (
    <div className="identity-rows">
      <DetailRow label="Issuer" value={manifest.issuer ?? 'Unknown'} />
      <DetailRow label="Generator" value={manifest.claimGenerator ?? 'Unknown'} />
      <DetailRow label="Signed At" value={manifest.signedAt ?? 'Unknown'} />
      <DetailRow label="Algorithm" value={manifest.signatureAlgorithm ?? 'Unknown'} />
      <DetailRow label="Active" value={manifest.isActive ? 'Yes' : 'No'} />
      {manifest.claimVersion !== undefined && (
        <DetailRow label="Claim Version" value={`${manifest.claimVersion}`} />
      )}
      {manifest.signatureInfo && (
        <>
          <div style={{ marginTop: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 10, color: 'var(--color-outline)', textTransform: 'uppercase',
              letterSpacing: '0.05em', fontFamily: "'JetBrains Mono', monospace",
            }}>
              Certificate Details
            </span>
          </div>
          <DetailRow label="CN" value={manifest.signatureInfo.commonName ?? 'N/A'} />
          <DetailRow label="Serial" value={manifest.signatureInfo.serialNumber ?? 'N/A'} />
          <DetailRow label="Valid From" value={manifest.signatureInfo?.notBefore ?? 'N/A'} />
          <DetailRow label="Valid To" value={manifest.signatureInfo?.notAfter ?? 'N/A'} />
          <DetailRow label="Digest Algo" value={manifest.signatureInfo?.digestAlgorithm ?? 'N/A'} />
        </>
      )}
    </div>
  );
}

function EvidenceDetails({ findings }: { findings: Finding[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {findings.map((f) => {
        const explanation = explainFinding(f);
        return (
          <div key={f.id} style={{
            padding: '10px 12px',
            background: 'var(--color-surface-lowest)',
            border: '1px solid var(--color-outline-variant)',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {STATUS_ICON[f.status]}
                <span style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--color-on-surface)',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {f.label}
                </span>
              </div>
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: STATUS_FILLS_BG[f.status],
                color: STATUS_TEXT_COLOR[f.status],
                border: `1px solid ${STATUS_BORDERS[f.status]}`,
                fontFamily: "'JetBrains Mono', monospace",
                textTransform: 'uppercase', fontWeight: 600,
              }}>
                {STATUS_LABELS[f.status]}
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-on-surface-dim)', lineHeight: 1.4, margin: 0 }}>
              {f.description}
            </p>
            {f.evidence.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {f.evidence.slice(0, 3).map((e, i) => (
                  <div key={i} style={{
                    fontSize: 10, color: 'var(--color-outline)',
                    fontFamily: "'JetBrains Mono', monospace",
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <ChevronRight size={10} />
                    <span>{e.source}</span>
                    {e.detail && <span style={{ color: 'var(--color-on-surface-dim)' }}>— {e.detail}</span>}
                  </div>
                ))}
              </div>
            )}
            {/* Why? explanation from evidence model */}
            <div style={{
              marginTop: 8, padding: '6px 8px', borderRadius: 4,
              background: 'rgba(76, 215, 246, 0.06)',
              border: '1px solid rgba(76, 215, 246, 0.12)',
              fontSize: 10, color: 'var(--color-on-surface-dim)',
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1.5,
              whiteSpace: 'pre-line',
            }}>
              <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>Why?</span>
              {'\n'}{explanation}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssertionList({ assertions }: { assertions: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {assertions.map((a, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px',
          background: 'var(--color-surface-lowest)',
          border: '1px solid var(--color-outline-variant)',
          borderRadius: 4,
        }}>
          <span style={{
            width: 20, height: 20, borderRadius: 4,
            background: 'rgba(76, 215, 246, 0.1)',
            color: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
          }}>
            {i + 1}
          </span>
          <span style={{
            fontSize: 11, color: 'var(--color-on-surface)',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {a}
          </span>
        </div>
      ))}
    </div>
  );
}

function IngredientList({ ingredients }: { ingredients: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {ingredients.map((ing, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px',
          background: 'var(--color-surface-lowest)',
          border: '1px solid var(--color-outline-variant)',
          borderRadius: 4,
        }}>
          <Package size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
          <span style={{
            fontSize: 11, color: 'var(--color-on-surface)',
            fontFamily: "'JetBrains Mono', monospace",
            overflowWrap: 'anywhere',
          }}>
            {ing}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Shared detail row ──────────────────────────────────────── */

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="identity-row">
      <span className="identity-row-label">{label}</span>
      <span className="identity-row-value" style={mono ? { fontFamily: "'JetBrains Mono', monospace", fontSize: 10 } : undefined}>
        {value}
      </span>
    </div>
  );
}

/* ── Status fill/border helpers ─────────────────────────────── */

const STATUS_FILLS_BG: Record<EvidenceStatus, string> = {
  verified: 'rgba(78, 222, 163, 0.12)',
  supported: 'rgba(76, 215, 246, 0.12)',
  claimed: 'rgba(245, 158, 11, 0.12)',
  unknown: 'rgba(134, 147, 151, 0.12)',
  contradicted: 'rgba(244, 63, 94, 0.12)',
  rejected: 'rgba(245, 158, 11, 0.12)',
  modified: 'rgba(168, 85, 247, 0.12)',
  stripped: 'rgba(244, 63, 94, 0.12)',
};

const STATUS_BORDERS: Record<EvidenceStatus, string> = {
  verified: 'rgba(78, 222, 163, 0.3)',
  supported: 'rgba(76, 215, 246, 0.3)',
  claimed: 'rgba(245, 158, 11, 0.3)',
  unknown: 'rgba(134, 147, 151, 0.3)',
  contradicted: 'rgba(244, 63, 94, 0.3)',
  rejected: 'rgba(245, 158, 11, 0.3)',
  modified: 'rgba(168, 85, 247, 0.3)',
  stripped: 'rgba(244, 63, 94, 0.3)',
};

/* ── Node type metadata ─────────────────────────────────────── */

const NODE_META: Record<NodeType, { label: string; icon: React.ReactNode; color: string }> = {
  file: { label: 'File', icon: <FileText size={16} />, color: 'var(--color-on-surface)' },
  manifest: { label: 'C2PA Manifest', icon: <Shield size={16} />, color: 'var(--color-primary)' },
  evidence: { label: 'Cryptographic Evidence', icon: <Key size={16} />, color: 'var(--color-secondary)' },
  assertions: { label: 'Assertions', icon: <Tag size={16} />, color: 'var(--color-tertiary)' },
  ingredients: { label: 'Ingredients', icon: <Package size={16} />, color: '#f59e0b' },
};

/* ── Main Component ─────────────────────────────────────────── */

export function ProvenanceEvidencePanel({ result, selectedNodeId, onClose }: ProvenanceEvidencePanelProps) {
  if (!result || !selectedNodeId) {
    return (
      <div className="provenance-evidence-panel" style={{
        padding: 24, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10,
        color: '#475569', minHeight: 200,
      }}>
        <Info size={32} style={{ color: 'var(--color-outline)' }} />
        <p style={{ fontSize: 12, textAlign: 'center', color: 'var(--color-on-surface-dim)' }}>
          Click a node in the graph to view its evidence details.
        </p>
      </div>
    );
  }

  const manifest = result.manifests.find((m) => m.isActive) ?? result.manifests[0];
  let findings: Finding[] = [];
  try {
    findings = deriveFindings(result);
  } catch (err) {
    console.error('[ProvenanceEvidencePanel] deriveFindings failed:', err);
  }

  const nodeType = selectedNodeId as NodeType;
  const meta = NODE_META[nodeType] ?? NODE_META.file;

  // Determine status for header
  let headerStatus: EvidenceStatus = 'unknown';
  if (nodeType === 'file') {
    headerStatus = result.validationState === 'Trusted' ? 'verified'
      : result.validationState === 'Valid' ? 'supported'
      : result.validationState === 'Invalid' ? 'contradicted' : 'unknown';
  } else if (nodeType === 'manifest') {
    headerStatus = manifest?.isActive ? 'verified' : 'supported';
  } else if (nodeType === 'evidence') {
    headerStatus = manifest?.validationCodes.every((v) => v.success) ? 'verified' : 'unknown';
  } else if (nodeType === 'assertions') {
    headerStatus = 'claimed';
  } else if (nodeType === 'ingredients') {
    headerStatus = 'supported';
  }

  return (
    <div className="provenance-evidence-panel" style={{
      display: 'flex', flexDirection: 'column', gap: 0,
      background: 'var(--color-surface-low)',
      border: '1px solid var(--color-outline-variant)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        background: 'var(--color-surface-lowest)',
        borderBottom: '1px solid var(--color-outline-variant)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: meta.color }}>{meta.icon}</span>
          <div>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--color-on-surface)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {meta.label}
            </div>
            <div style={{
              fontSize: 10, color: STATUS_TEXT_COLOR[headerStatus],
              fontFamily: "'JetBrains Mono', monospace",
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {STATUS_ICON[headerStatus]}
              {STATUS_LABELS[headerStatus]}
            </div>
          </div>
        </div>
        {onClose && (
          <button
            className="action-tactile button-ghost"
            type="button"
            onClick={onClose}
            style={{ padding: 4 }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: 14, overflowY: 'auto', maxHeight: 400 }}>
        {nodeType === 'file' && <FileDetails result={result} />}
        {nodeType === 'manifest' && manifest && <ManifestDetails manifest={manifest} />}
        {nodeType === 'evidence' && <EvidenceDetails findings={findings.filter((f) => ['signature', 'content-binding'].includes(f.category))} />}
        {nodeType === 'assertions' && manifest && <AssertionList assertions={manifest.assertions} />}
        {nodeType === 'ingredients' && manifest && <IngredientList ingredients={manifest.ingredients} />}
      </div>

      {/* All Findings Summary */}
      {nodeType !== 'file' && findings.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--color-outline-variant)',
          padding: '10px 14px',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: 'var(--color-outline)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: 8,
          }}>
            Related Findings
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {findings.slice(0, 4).map((f) => (
              <span key={f.id} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 4,
                background: STATUS_FILLS_BG[f.status],
                color: STATUS_TEXT_COLOR[f.status],
                border: `1px solid ${STATUS_BORDERS[f.status]}`,
                fontFamily: "'JetBrains Mono', monospace",
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {STATUS_EMOJI[f.status]} {f.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProvenanceEvidencePanel;
