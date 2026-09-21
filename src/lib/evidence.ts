/**
 * Evidence model — the core domain types for Watermark.
 *
 * Watermark is bilateral: it presents BOTH sides of every provenance claim.
 * Nothing is taken at face value. Everything is falsifiable.
 *
 * The tool is useful for:
 * - Content creators who WANT provenance (journalists, photographers)
 * - Privacy advocates who want to RESIST unwanted provenance
 * - Investigators who need to evaluate claims objectively
 * - Educators who need to explain both sides
 *
 * Core principle: There is no law requiring submission to provenance tyranny.
 * Users have the right to understand, modify, or remove provenance from their own files.
 *
 * Design principles:
 * - Always show what the manifest CLAIMS vs what can be VERIFIED
 * - Make all findings falsifiable — every claim has evidence that could contradict it
 * - Accommodate both agreement and disagreement with provenance
 * - Present evidence, not conclusions — let the user decide
 */

// ── Evidence Status ────────────────────────────────────────────

/**
 * How confident are we in this finding?
 *
 * - "verified":     Cryptographically confirmed (signature valid, binding matches)
 * - "supported":    Consistent with evidence but not independently verified
 * - "claimed":      Stated in the manifest but not independently verified (e.g., AI-generated)
 * - "unknown":      No evidence available either way
 * - "contradicted": Evidence contradicts the claim
 * - "rejected":     User has explicitly rejected this provenance claim
 * - "modified":     Provenance has been intentionally altered by the user
 * - "stripped":     Provenance has been intentionally removed by the user
 */
export type EvidenceStatus = 'verified' | 'supported' | 'claimed' | 'unknown' | 'contradicted' | 'rejected' | 'modified' | 'stripped';

// ── Perspective ────────────────────────────────────────────────

/**
 * Which perspective is this finding from?
 * A bilateral tool always shows both sides.
 */
export type Perspective = 'manifest' | 'independent' | 'user';

export const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  manifest: 'Manifest Claims',
  independent: 'Independent Verification',
  user: 'User Actions',
};

export const PERSPECTIVE_COLORS: Record<Perspective, string> = {
  manifest: 'var(--color-secondary)',
  independent: 'var(--color-primary)',
  user: 'var(--color-tertiary)',
};

// ── Evidence References ────────────────────────────────────────

export interface EvidenceRef {
  /** Where did this evidence come from? */
  source: 'c2pa-manifest' | 'c2pa-signature' | 'c2pa-binding' | 'c2pa-assertion' | 'exif' | 'binary' | 'analysis' | 'user';
  /** Specific detail (e.g., assertion label, field name) */
  detail?: string;
  /** Link to spec or documentation, if applicable */
  specRef?: string;
}

// ── Findings ───────────────────────────────────────────────────

export interface Finding {
  id: string;
  category: FindingCategory;
  status: EvidenceStatus;
  perspective: Perspective;
  confidence: number; // 0-100
  label: string;
  description: string;
  evidence: EvidenceRef[];
  /** For UI: should this show a "Why?" explanation? */
  explainer?: string;
  /** For bilateral display: what would contradict this finding? */
  counterEvidence?: string;
}

export type FindingCategory =
  | 'signature'
  | 'content-binding'
  | 'issuer-trust'
  | 'manifest-integrity'
  | 'ai-generation'
  | 'watermark'
  | 'soft-binding'
  | 'metadata-consistency'
  | 'temporal-validity'
  | 'provenance-chain';

// ── Evidence Summary ───────────────────────────────────────────

export interface EvidenceSummary {
  /** Overall verification status */
  overallStatus: EvidenceStatus;
  /** All findings */
  findings: Finding[];
  /** Count by status */
  counts: Record<EvidenceStatus, number>;
  /** Timestamp of analysis */
  analyzedAt: string;
  /** File this summary describes */
  fileSha256: string;
  fileName: string;
}

// ── Helpers ────────────────────────────────────────────────────

/** Status → display label */
export const STATUS_LABELS: Record<EvidenceStatus, string> = {
  verified: 'Verified',
  supported: 'Supported',
  claimed: 'Claimed',
  unknown: 'Unknown',
  contradicted: 'Contradicted',
  rejected: 'Rejected',
  modified: 'Modified',
  stripped: 'Stripped',
};

/** Status → color class */
export const STATUS_COLORS: Record<EvidenceStatus, string> = {
  verified: 'var(--color-tertiary)',
  supported: 'var(--color-primary)',
  claimed: 'var(--color-secondary)',
  unknown: 'var(--color-muted)',
  contradicted: 'var(--color-error)',
  rejected: '#f59e0b',
  modified: '#a855f7',
  stripped: '#f43f5e',
};

/** Status → emoji for inline display */
export const STATUS_EMOJI: Record<EvidenceStatus, string> = {
  verified: '✓',
  supported: '◐',
  claimed: '△',
  unknown: '?',
  contradicted: '✗',
  rejected: '🚫',
  modified: '✏️',
  stripped: '🗑️',
};

/** Category → human label */
export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  'signature': 'Digital Signature',
  'content-binding': 'Content Binding',
  'issuer-trust': 'Issuer Trust',
  'manifest-integrity': 'Manifest Integrity',
  'ai-generation': 'AI Generation',
  'watermark': 'Watermark / Steganography',
  'soft-binding': 'Soft Binding',
  'metadata-consistency': 'Metadata Consistency',
  'temporal-validity': 'Temporal Validity',
  'provenance-chain': 'Provenance Chain',
};

/** Generate a "Why?" explanation for a finding — bilateral, falsifiable */
export function explainFinding(finding: Finding): string {
  const parts: string[] = [];

  // Perspective header
  parts.push(`[${PERSPECTIVE_LABELS[finding.perspective]}]`);

  // Status explanation
  switch (finding.status) {
    case 'verified':
      parts.push(`✓ ${finding.label} is cryptographically verified.`);
      break;
    case 'claimed':
      parts.push(`△ ${finding.label} is claimed in the manifest but not independently verified.`);
      break;
    case 'contradicted':
      parts.push(`✗ ${finding.label} is contradicted by available evidence.`);
      break;
    case 'rejected':
      parts.push(`🚫 ${finding.label} has been explicitly rejected.`);
      break;
    case 'modified':
      parts.push(`✏️ ${finding.label} has been intentionally modified.`);
      break;
    case 'stripped':
      parts.push(`🗑️ ${finding.label} has been intentionally removed.`);
      break;
    default:
      parts.push(`${finding.label}: ${finding.description}`);
  }

  // Evidence references
  if (finding.evidence.length > 0) {
    parts.push(`Evidence: ${finding.evidence.map(e => `${e.source}${e.detail ? ` (${e.detail})` : ''}`).join(', ')}`);
  }

  // Confidence
  if (finding.confidence < 100) {
    parts.push(`Confidence: ${finding.confidence}%`);
  }

  // Counter-evidence (falsifiability)
  if (finding.counterEvidence) {
    parts.push(`\nWhat would contradict this: ${finding.counterEvidence}`);
  }

  return parts.join('\n');
}

/** Create a finding from verification data */
export function createFinding(
  id: string,
  category: FindingCategory,
  status: EvidenceStatus,
  perspective: Perspective,
  confidence: number,
  label: string,
  description: string,
  evidence: EvidenceRef[],
  explainer?: string,
  counterEvidence?: string,
): Finding {
  return { id, category, status, perspective, confidence, label, description, evidence, explainer, counterEvidence };
}

/** Build an evidence summary from a list of findings */
export function buildSummary(
  findings: Finding[],
  fileSha256: string,
  fileName: string,
): EvidenceSummary {
  const counts: Record<EvidenceStatus, number> = {
    verified: 0,
    supported: 0,
    claimed: 0,
    unknown: 0,
    contradicted: 0,
    rejected: 0,
    modified: 0,
    stripped: 0,
  };
  for (const f of findings) counts[f.status]++;

  // Overall status: worst-case, but user actions take priority
  let overall: EvidenceStatus = 'verified';
  if (counts.rejected > 0) overall = 'rejected';
  else if (counts.stripped > 0) overall = 'stripped';
  else if (counts.modified > 0) overall = 'modified';
  else if (counts.contradicted > 0) overall = 'contradicted';
  else if (counts.unknown > 0 && counts.verified === 0) overall = 'unknown';
  else if (counts.claimed > 0 && counts.verified === 0) overall = 'claimed';
  else if (counts.supported > 0 && counts.verified === 0) overall = 'supported';

  return {
    overallStatus: overall,
    findings,
    counts,
    analyzedAt: new Date().toISOString(),
    fileSha256,
    fileName,
  };
}
