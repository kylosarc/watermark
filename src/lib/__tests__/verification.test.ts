import { describe, expect, it } from 'vitest';
import type { ManifestStore } from '@contentauth/c2pa-web';
import { errorResult, missingCredentialResult, summarizeManifestStore } from '../verification';

type Json = Record<string, unknown>;

function makeStore(overrides: Json = {}): ManifestStore {
  return {
    validation_state: 'Valid',
    manifests: {},
    ...overrides,
  } as unknown as ManifestStore;
}

function makeManifest(overrides: Json = {}): Json {
  return {
    label: 'urn:uuid:active',
    title: 'capture.jpg',
    format: 'image/jpeg',
    ...overrides,
  };
}

function summarize(store: ManifestStore) {
  return summarizeManifestStore(store, 'capture.jpg', 2048, 'image/jpeg', 'abc123');
}

describe('summarizeManifestStore', () => {
  it('reports a missing manifest without inventing a validation state', () => {
    const result = summarize(makeStore({ validation_state: 'Trusted' }));

    expect(result.status).toBe('missing');
    expect(result.validationState).toBe('Unknown');
    expect(result.manifestCount).toBe(0);
    expect(result.manifests).toEqual([]);
    expect(result.warnings).toEqual(['No C2PA manifest was found in this asset.']);
  });

  it('summarizes the active manifest, signature, ingredients, and claims', () => {
    const store = makeStore({
      validation_state: 'Trusted',
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          claim_version: 2,
          claim_generator: 'fallback/1.0',
          claim_generator_info: [{ name: 'Adobe Photoshop', version: '26.1' }],
          ingredients: [
            { title: 'source.png' },
            { hash: 'deadbeef' },
            {},
          ],
          assertions: [
            {
              label: 'c2pa.actions',
              data: [{
                action: 'c2pa.created',
                digitalSourceType: 'http://c2pa.org/digitalsourcetype/trainedAlgorithmicMedia',
              }],
            },
            { label: 'c2pa.soft-binding', data: { alg: 'phash' } },
            { label: 'c2pa.watermark.synthid', data: { detector: 'SynthID' } },
          ],
          signature_info: {
            issuer: 'Example Trust CA',
            common_name: 'Example Signer',
            cert_serial_number: '00A1B2',
            alg: 'Es256',
            time: '2026-01-02T03:04:05Z',
          },
        }),
      },
    });

    const result = summarize(store);
    const manifest = result.manifests[0];

    expect(result.status).toBe('ready');
    expect(result.validationState).toBe('Trusted');
    expect(result.manifestCount).toBe(1);
    expect(result.activeManifest).toBe('urn:uuid:active');
    expect(result.warnings).toEqual([]);

    expect(manifest.label).toBe('urn:uuid:active');
    expect(manifest.isActive).toBe(true);
    expect(manifest.title).toBe('capture.jpg');
    expect(manifest.format).toBe('image/jpeg');
    expect(manifest.claimGenerator).toBe('Adobe Photoshop 26.1');
    expect(manifest.issuer).toBe('Example Trust CA');
    expect(manifest.signatureAlgorithm).toBe('Es256');
    expect(manifest.signedAt).toBe('2026-01-02T03:04:05Z');
    expect(manifest.claimVersion).toBe(2);
    expect(manifest.ingredients).toEqual(['source.png', 'deadbeef', 'Unnamed ingredient']);
    expect(manifest.assertions).toEqual([
      'c2pa.actions',
      'c2pa.soft-binding',
      'c2pa.watermark.synthid',
    ]);
    expect(manifest.softBinding).toEqual([
      { algorithm: 'c2pa.soft-binding', value: JSON.stringify({ alg: 'phash' }) },
    ]);
    expect(manifest.digitalSourceType).toBe('http://c2pa.org/digitalsourcetype/trainedAlgorithmicMedia');
    expect(manifest.isAIGenerated).toBe(true);
    expect(manifest.watermarkClaims).toEqual(['c2pa.watermark.synthid']);
    expect(manifest.signatureInfo).toEqual({
      issuer: 'Example Trust CA',
      commonName: 'Example Signer',
      serialNumber: '00A1B2',
    });
  });

  it('warns when a manifest is valid but the issuer is not trusted', () => {
    const result = summarize(makeStore({
      validation_state: 'Valid',
      active_manifest: 'urn:uuid:active',
      manifests: { 'urn:uuid:active': makeManifest() },
    }));

    expect(result.validationState).toBe('Valid');
    expect(result.warnings).toContain(
      'The manifest is structurally and cryptographically valid, but this SDK did not establish a trusted issuer.'
    );
  });

  it('warns when the store does not identify an active manifest', () => {
    const result = summarize(makeStore({
      validation_state: 'Valid',
      manifests: { 'urn:uuid:orphan': makeManifest() },
    }));

    expect(result.manifests[0].isActive).toBe(false);
    expect(result.warnings).toContain('The manifest store does not identify an active manifest.');
  });

  it('marks invalid stores as invalid even when manifests are present', () => {
    const result = summarize(makeStore({
      validation_state: 'Invalid',
      active_manifest: 'urn:uuid:active',
      manifests: { 'urn:uuid:active': makeManifest() },
    }));

    expect(result.status).toBe('invalid');
    expect(result.validationState).toBe('Invalid');
    expect(result.manifestCount).toBe(1);
  });

  it('normalizes unrecognized validation states to Unknown', () => {
    const result = summarize(makeStore({
      validation_state: 'ProbablyFine',
      active_manifest: 'urn:uuid:active',
      manifests: { 'urn:uuid:active': makeManifest() },
    }));

    expect(result.validationState).toBe('Unknown');
    expect(result.status).toBe('ready');
  });

  it('deduplicates validation codes across the store, results, and manifest', () => {
    const duplicate = { code: 'assertion.missing', explanation: 'A required assertion is absent', success: false };
    const result = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          validation_status: [duplicate],
        }),
      },
      validation_state: 'Trusted',
      validation_status: [duplicate, duplicate],
      validation_results: {
        activeManifest: {
          success: [],
          informational: [{ code: 'info.code', explanation: 'Extra context', success: true }],
          failure: [
            { code: 'signature.mismatch', explanation: 'Signature does not match', success: false },
            duplicate,
          ],
        },
      },
    }));

    const codes = result.manifests[0].validationCodes;

    expect(codes).toEqual([
      { code: 'assertion.missing', explanation: 'A required assertion is absent', success: false },
      { code: 'info.code', explanation: 'Extra context', success: true },
      { code: 'signature.mismatch', explanation: 'Signature does not match', success: false },
    ]);
    expect(result.warnings).toEqual([
      'A required assertion is absent',
      'Signature does not match',
    ]);
  });

  it('falls back through generator, issuer, and ingredient labels', () => {
    const result = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          claim_generator_info: [{ name: 'OnlyName' }],
          signature_info: { issuer: '', common_name: 'Fallback CN' },
          ingredients: [
            { title: 'title-wins', hash: 'hash-loses' },
            { instance_id: 'instance-fallback' },
            { label: 'label-fallback' },
          ],
        }),
      },
    }));

    const manifest = result.manifests[0];
    expect(manifest.claimGenerator).toBe('OnlyName');
    expect(manifest.issuer).toBe('Fallback CN');
    expect(manifest.ingredients).toEqual(['title-wins', 'instance-fallback', 'label-fallback']);
  });

  it('uses the legacy claim_generator when generator info is absent', () => {
    const result = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({ claim_generator: 'LegacyVendor/2.0' }),
      },
    }));

    expect(result.manifests[0].claimGenerator).toBe('LegacyVendor/2.0');
  });

  it('detects AI source types in both action shapes and rejects unknown types', () => {
    const nested = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          assertions: [{
            label: 'c2pa.actions.v2',
            data: [{ type: { digitalSource: 'http://c2pa.org/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' } }],
          }],
        }),
      },
    }));
    expect(nested.manifests[0].isAIGenerated).toBe(true);

    const unknown = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          assertions: [{
            label: 'c2pa.actions',
            data: [{ digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' }],
          }],
        }),
      },
    }));
    expect(unknown.manifests[0].digitalSourceType).toBe('http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture');
    expect(unknown.manifests[0].isAIGenerated).toBe(false);

    const iptc = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          assertions: [{
            label: 'c2pa.actions.v2',
            data: [{ digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }],
          }],
        }),
      },
    }));
    expect(iptc.manifests[0].isAIGenerated).toBe(true);
  });

  it('finds soft binding and watermark claims in labels and assert data', () => {
    const result = summarize(makeStore({
      active_manifest: 'urn:uuid:active',
      manifests: {
        'urn:uuid:active': makeManifest({
          assertions: [
            { label: 'c2pa.soft_binding', data: null },
            { label: 'c2pa.actions', data: { softwareAgent: 'SynthID watermark embedder' } },
          ],
        }),
      },
    }));

    expect(result.manifests[0].softBinding).toEqual([
      { algorithm: 'c2pa.soft_binding', value: '""' },
    ]);
    expect(result.manifests[0].watermarkClaims).toEqual(['c2pa.actions']);
  });
});

describe('verification result helpers', () => {
  it('builds a missing-credential result with the original file metadata', () => {
    const result = missingCredentialResult('empty.png', 12, 'image/png', 'feedface');

    expect(result.status).toBe('missing');
    expect(result.fileName).toBe('empty.png');
    expect(result.fileSize).toBe(12);
    expect(result.mimeType).toBe('image/png');
    expect(result.sha256).toBe('feedface');
    expect(result.validationState).toBe('Unknown');
    expect(result.warnings).toHaveLength(1);
  });

  it('preserves an error message and falls back for non-Error throws', () => {
    const error = errorResult('broken.png', 3, 'image/png', '', new Error('decoder exploded'));
    expect(error.status).toBe('error');
    expect(error.error).toBe('decoder exploded');

    const fallback = errorResult('broken.png', 3, 'image/png', '', 'not an error');
    expect(fallback.error).toBe('Unable to inspect this asset.');
  });
});
