/**
 * Evidence model — the core domain types for Watermark.
 *
 * Instead of simple true/false, every finding carries:
 * - An evidence status (verified, supported, claimed, unknown, contradicted)
 * - A confidence level
 * - References to the specific evidence that supports it
 *
 * This makes the tool's verification boundaries visible in the UI
 * rather than buried in documentation.
 */

// ── Evidence Status ────────────────────────────────────────────

/**
 * How confident are we in this finding?
 *
 * - "verified":   Cryptographically confirmed (signature valid, binding matches)
 * - "supported":  Consistent with evidence but not independently verified
 * - "claimed":    Stated in the manifest but not independently verified (e.g., AI-generated)
 * - "unknown":    No evidence available either way
 * - "contradicted": Evidence contradicts the claim
 */
export type EvidenceStatus = 'verified' | 'supported' | 'claimed' | 'unknown' | 'contradicted';

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
  confidence: number; // 0-100
  label: string;
  description: string;
  evidence: EvidenceRef[];
  /** For UI: should this show a "Why?" explanation? */
  explainer?: string;
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
};

/** Status → color class */
export const STATUS_COLORS: Record<EvidenceStatus, string> = {
  verified: 'var(--color-tertiary)',
  supported: 'var(--color-primary)',
  claimed: 'var(--color-secondary)',
  unknown: 'var(--color-muted)',
  contradicted: 'var(--color-error)',
};

/** Status → emoji for inline display */
export const STATUS_EMOJI: Record<EvidenceStatus, string> = {
  verified: '✓',
  supported: '◐',
  claimed: '△',
  unknown: '?',
  contradicted: '✗',
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

/** Create a finding from verification data */
export function createFinding(
  id: string,
  category: FindingCategory,
  status: EvidenceStatus,
  confidence: number,
  label: string,
  description: string,
  evidence: EvidenceRef[],
  explainer?: string,
): Finding {
  return { id, category, status, confidence, label, description, evidence, explainer };
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
  };
  for (const f of findings) counts[f.status]++;

  // Overall status: worst-case
  let overall: EvidenceStatus = 'verified';
  if (counts.contradicted > 0) overall = 'contradicted';
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
