import { describe, expect, it } from 'vitest';
import { computeCrossFilePatterns, patternsExport } from '../batchPatterns';
import type { ManifestSummary, VerificationResult } from '../types';

function manifest(overrides: Partial<ManifestSummary> = {}): ManifestSummary {
  return {
    label: 'urn:uuid:active',
    isActive: true,
    ingredients: [],
    assertions: [],
    validationCodes: [],
    ...overrides,
  };
}

function verification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    status: 'ready',
    fileName: 'capture.jpg',
    fileSize: 1024,
    mimeType: 'image/jpeg',
    sha256: 'abc123',
    validationState: 'Trusted',
    manifestCount: 1,
    manifests: [manifest()],
    warnings: [],
    ...overrides,
  };
}

describe('computeCrossFilePatterns', () => {
  it('counts values by file and only shares assertions seen in 2+ files', () => {
    const patterns = computeCrossFilePatterns([
      verification({
        manifests: [manifest({
          issuer: 'CA One',
          claimGenerator: 'Camera 1.0',
          signatureAlgorithm: 'Es256',
          assertions: ['c2pa.actions', 'c2pa.hash.data', 'c2pa.actions'],
        })],
      }),
      verification({
        manifests: [manifest({
          issuer: 'CA Two',
          claimGenerator: 'Camera 1.0',
          signatureAlgorithm: 'Ps256',
          assertions: ['c2pa.actions', 'c2pa.training-mining'],
        })],
      }),
    ]);

    expect(patterns.totalFiles).toBe(2);
    expect(patterns.withC2PA).toBe(2);
    expect(patterns.issuers).toEqual([
      { value: 'CA One', files: 1 },
      { value: 'CA Two', files: 1 },
    ]);
    expect(patterns.generators).toEqual([{ value: 'Camera 1.0', files: 2 }]);
    expect(patterns.algorithms).toEqual([
      { value: 'Es256', files: 1 },
      { value: 'Ps256', files: 1 },
    ]);
    expect(patterns.sharedAssertions).toEqual([{ value: 'c2pa.actions', files: 2 }]);
  });

  it('counts AI, watermark, and soft-binding signals once per file', () => {
    const patterns = computeCrossFilePatterns([
      verification({
        manifests: [
          manifest({ isAIGenerated: true, watermarkClaims: ['c2pa.watermark'] }),
          manifest({ isActive: false, isAIGenerated: true, softBinding: [{ algorithm: 'phash', value: '1' }] }),
        ],
      }),
      verification({
        manifests: [manifest({ isAIGenerated: false, watermarkClaims: ['synthid'] })],
      }),
      verification({ manifests: [manifest()] }),
    ]);

    expect(patterns.aiGenerated).toBe(1);
    expect(patterns.watermarkClaims).toBe(2);
    expect(patterns.softBindings).toBe(1);
  });

  it('splits the validation mix, including files without C2PA', () => {
    const patterns = computeCrossFilePatterns([
      verification({ validationState: 'Trusted' }),
      verification({ validationState: 'Valid' }),
      verification({ validationState: 'Invalid' }),
      verification({ validationState: 'Unknown' }),
      verification({ status: 'missing', validationState: 'Unknown', manifestCount: 0, manifests: [] }),
    ]);

    expect(patterns.trusted).toBe(1);
    expect(patterns.valid).toBe(1);
    expect(patterns.invalid).toBe(1);
    expect(patterns.unknown).toBe(2);
    expect(patterns.withC2PA).toBe(4);
    expect(patterns.withoutC2PA).toBe(1);
  });

  it('finds the earliest and latest valid signing times', () => {
    const patterns = computeCrossFilePatterns([
      verification({ manifests: [manifest({ signedAt: '2026-03-01T00:00:00Z' })] }),
      verification({ manifests: [manifest({ signedAt: 'not-a-date' })] }),
      verification({ manifests: [manifest({ signedAt: '2025-12-31T23:59:59Z' })] }),
    ]);

    expect(patterns.signedRange).toEqual({
      earliest: '2025-12-31T23:59:59Z',
      latest: '2026-03-01T00:00:00Z',
    });
  });

  it('states what the batch cannot prove', () => {
    const patterns = computeCrossFilePatterns([
      verification({
        manifests: [manifest({
          issuer: 'CA One',
          isAIGenerated: true,
          watermarkClaims: ['synthid'],
        })],
      }),
      verification({
        manifests: [manifest({ issuer: 'CA Two' })],
      }),
      verification({ status: 'error', manifests: [], manifestCount: 0, validationState: 'Unknown' }),
      verification({ status: 'missing', manifests: [], manifestCount: 0, validationState: 'Unknown' }),
    ]);

    expect(patterns.notes.filter((note) => note.includes('could not be verified'))).toHaveLength(1);
    expect(patterns.notes.filter((note) => note.includes('carry no C2PA manifest'))).toHaveLength(1);
    expect(patterns.notes.filter((note) => note.includes('different issuers'))).toHaveLength(1);
    expect(patterns.notes.filter((note) => note.includes('AI-related DigitalSourceType'))).toHaveLength(1);
    expect(patterns.notes.filter((note) => note.includes('watermark or SynthID'))).toHaveLength(1);
    expect(patterns.notes.some((note) => note.startsWith('1 file declares'))).toBe(true);
    expect(patterns.notes.some((note) => note.startsWith('1 file mentions'))).toBe(true);
  });

  it('returns an empty but well-formed summary', () => {
    const patterns = computeCrossFilePatterns([]);

    expect(patterns.totalFiles).toBe(0);
    expect(patterns.issuers).toEqual([]);
    expect(patterns.sharedAssertions).toEqual([]);
    expect(patterns.signedRange).toEqual({ earliest: undefined, latest: undefined });
    expect(patterns.notes).toEqual([]);
  });
});

describe('patternsExport', () => {
  it('wraps the patterns in a versioned, traceable schema', () => {
    const patterns = computeCrossFilePatterns([verification()]);
    const exported = JSON.parse(patternsExport(patterns));

    expect(exported._schema).toBe('watermark.batch-patterns/1.0');
    expect(exported.tool).toBe('watermark');
    expect(typeof exported.exportedAt).toBe('string');
    expect(exported.patterns).toEqual(patterns);
  });
});
