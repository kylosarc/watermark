/**
 * Cross-file pattern analysis for Batch Inspection.
 *
 * This is deliberately derived from the same VerificationResult objects the
 * table and exports already use. No extra state, no hidden inference: every
 * count here can be traced back to a manifest the user can open.
 */

import type { ManifestSummary, VerificationResult } from './types';

export interface PatternCount {
  value: string;
  files: number;
}

export interface SignedRange {
  earliest?: string;
  latest?: string;
}

export interface CrossFilePatterns {
  totalFiles: number;
  withC2PA: number;
  withoutC2PA: number;
  trusted: number;
  valid: number;
  invalid: number;
  unknown: number;
  issuers: PatternCount[];
  generators: PatternCount[];
  algorithms: PatternCount[];
  sharedAssertions: PatternCount[];
  aiGenerated: number;
  watermarkClaims: number;
  softBindings: number;
  signedRange: SignedRange;
  notes: string[];
}

function activeManifest(result: VerificationResult): ManifestSummary | undefined {
  return result.manifests.find((manifest) => manifest.isActive) ?? result.manifests[0];
}

function bump(map: Map<string, number>, value: string | undefined): void {
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + 1);
}

function toCounts(map: Map<string, number>, minimumFiles = 1): PatternCount[] {
  return [...map.entries()]
    .filter(([, files]) => files >= minimumFiles)
    .map(([value, files]) => ({ value, files }))
    .sort((a, b) => b.files - a.files || a.value.localeCompare(b.value));
}

function parseSignedAt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function computeCrossFilePatterns(results: VerificationResult[]): CrossFilePatterns {
  const issuers = new Map<string, number>();
  const generators = new Map<string, number>();
  const algorithms = new Map<string, number>();
  const assertions = new Map<string, number>();

  let withC2PA = 0;
  let trusted = 0;
  let valid = 0;
  let invalid = 0;
  let unknown = 0;
  let aiGenerated = 0;
  let watermarkClaims = 0;
  let softBindings = 0;
  let errorFiles = 0;
  let earliest: { value: string; time: number } | undefined;
  let latest: { value: string; time: number } | undefined;

  for (const result of results) {
    if (result.status === 'error') errorFiles += 1;

    if (result.manifestCount > 0) {
      withC2PA += 1;
    }

    if (result.validationState === 'Trusted') trusted += 1;
    else if (result.validationState === 'Valid') valid += 1;
    else if (result.validationState === 'Invalid') invalid += 1;
    else unknown += 1;

    const active = activeManifest(result);
    if (active) {
      bump(issuers, active.issuer);
      bump(generators, active.claimGenerator);
      bump(algorithms, active.signatureAlgorithm);

      const seen = new Set(active.assertions);
      for (const assertion of seen) {
        bump(assertions, assertion);
      }

      const signedTime = parseSignedAt(active.signedAt);
      if (signedTime !== undefined && active.signedAt) {
        if (!earliest || signedTime < earliest.time) {
          earliest = { value: active.signedAt, time: signedTime };
        }
        if (!latest || signedTime > latest.time) {
          latest = { value: active.signedAt, time: signedTime };
        }
      }
    }

    if (result.manifests.some((manifest) => manifest.isAIGenerated)) aiGenerated += 1;
    if (result.manifests.some((manifest) => (manifest.watermarkClaims?.length ?? 0) > 0)) watermarkClaims += 1;
    if (result.manifests.some((manifest) => (manifest.softBinding?.length ?? 0) > 0)) softBindings += 1;
  }

  const withoutC2PA = results.length - withC2PA;
  const notes: string[] = [];

  if (errorFiles > 0) {
    notes.push(`${errorFiles} file${errorFiles === 1 ? '' : 's'} could not be verified. Treat those rows as unknown, not clean.`);
  }
  if (withoutC2PA > 0) {
    notes.push(`${withoutC2PA} of ${results.length} files carry no C2PA manifest. Absence is not proof of editing, and presence is not proof of truth.`);
  }
  if (issuers.size > 1) {
    notes.push(`${issuers.size} different issuers appear in this batch. Compare them rather than treating the batch as one origin.`);
  }
  if (withC2PA > 0 && !earliest) {
    notes.push('Signed manifests did not report a signing time, so ordering cannot be established from this batch alone.');
  }
  if (aiGenerated > 0) {
    notes.push(`${aiGenerated} file${aiGenerated === 1 ? '' : 's'} ${aiGenerated === 1 ? 'declares' : 'declare'} an AI-related DigitalSourceType. That is a claim by the signer, not a detector result.`);
  }
  if (watermarkClaims > 0) {
    notes.push(`${watermarkClaims} file${watermarkClaims === 1 ? '' : 's'} ${watermarkClaims === 1 ? 'mentions' : 'mention'} watermark or SynthID assertions. The label describes a claim; it does not verify the signal.`);
  }

  return {
    totalFiles: results.length,
    withC2PA,
    withoutC2PA,
    trusted,
    valid,
    invalid,
    unknown,
    issuers: toCounts(issuers),
    generators: toCounts(generators),
    algorithms: toCounts(algorithms),
    sharedAssertions: toCounts(assertions, 2),
    aiGenerated,
    watermarkClaims,
    softBindings,
    signedRange: {
      earliest: earliest?.value,
      latest: latest?.value,
    },
    notes,
  };
}

export function patternsExport(patterns: CrossFilePatterns): string {
  return JSON.stringify({
    _schema: 'watermark.batch-patterns/1.0',
    exportedAt: new Date().toISOString(),
    tool: 'watermark',
    patterns,
  }, null, 2);
}
