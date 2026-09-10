import type { Ingredient, Manifest, ManifestStore, ValidationStatus } from '@contentauth/c2pa-web';
import type { ManifestSummary, ValidationCode, ValidationState, VerificationResult } from './types';

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function uniqueCodes(statuses: ValidationStatus[]): ValidationCode[] {
  const seen = new Set<string>();
  return statuses.flatMap((status) => {
    const key = `${status.code}:${status.explanation ?? ''}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      code: status.code,
      explanation: asText(status.explanation),
      success: status.success ?? undefined,
      url: asText(status.url)
    }];
  });
}

function getStoreCodes(store: ManifestStore): ValidationStatus[] {
  const direct = store.validation_status ?? [];
  const results = store.validation_results;
  const active = results?.activeManifest;
  const fromResults = [
    ...(active?.success ?? []),
    ...(active?.informational ?? []),
    ...(active?.failure ?? [])
  ];
  return [...direct, ...fromResults];
}

function getManifestCodes(manifest: Manifest): ValidationStatus[] {
  const value = manifest.validation_status;
  return Array.isArray(value) ? value : [];
}

function getGenerator(manifest: Manifest): string | undefined {
  const info = manifest.claim_generator_info?.[0];
  const name = asText(info?.name);
  const version = asText(info?.version);
  return name ? [name, version].filter(Boolean).join(' ') : asText(manifest.claim_generator);
}

function getIngredientLabel(ingredient: Ingredient): string {
  return asText(ingredient.title)
    ?? asText(ingredient.hash)
    ?? asText(ingredient.instance_id)
    ?? asText(ingredient.label)
    ?? 'Unnamed ingredient';
}

function getAssertionLabels(manifest: Manifest): string[] {
  return (manifest.assertions ?? []).map((assertion) => assertion.label);
}

function toValidationState(value: ManifestStore['validation_state']): ValidationState {
  if (value === 'Trusted' || value === 'Valid' || value === 'Invalid') {
    return value;
  }
  return 'Unknown';
}

export function summarizeManifestStore(
  store: ManifestStore,
  fileName: string,
  fileSize: number,
  mimeType: string,
  sha256: string
): VerificationResult {
  const entries = Object.entries(store.manifests ?? {});
  const activeManifest = asText(store.active_manifest);
  const state = toValidationState(store.validation_state);
  const storeCodes = uniqueCodes(getStoreCodes(store));
  const warnings: string[] = [];

  if (entries.length === 0) {
    return {
      status: 'missing',
      fileName,
      fileSize,
      mimeType,
      sha256,
      validationState: 'Unknown',
      manifestCount: 0,
      manifests: [],
      warnings: ['No C2PA manifest was found in this asset.']
    };
  }

  if (state === 'Valid') {
    warnings.push('The manifest is structurally and cryptographically valid, but this SDK did not establish a trusted issuer.');
  }
  if (!activeManifest) {
    warnings.push('The manifest store does not identify an active manifest.');
  }

  const manifests: ManifestSummary[] = entries.map(([key, manifest]) => {
    const signature = manifest.signature_info;
    return {
      label: asText(manifest.label) ?? key,
      isActive: activeManifest ? asText(manifest.label) === activeManifest : false,
      title: asText(manifest.title),
      format: asText(manifest.format),
      claimGenerator: getGenerator(manifest),
      issuer: asText(signature?.issuer) ?? asText(signature?.common_name),
      signatureAlgorithm: asText(signature?.alg),
      signedAt: asText(signature?.time),
      ingredients: (manifest.ingredients ?? []).map(getIngredientLabel),
      assertions: getAssertionLabels(manifest),
      validationCodes: uniqueCodes([
        ...getStoreCodes(store),
        ...getManifestCodes(manifest)
      ])
    };
  });

  return {
    status: state === 'Invalid' ? 'invalid' : 'ready',
    fileName,
    fileSize,
    mimeType,
    sha256,
    validationState: state,
    manifestCount: manifests.length,
    activeManifest,
    manifests,
    warnings: [...warnings, ...storeCodes.filter((code) => !code.success).map((code) => code.explanation).filter((value): value is string => Boolean(value))]
  };
}

export function missingCredentialResult(
  fileName: string,
  fileSize: number,
  mimeType: string,
  sha256: string
): VerificationResult {
  return {
    status: 'missing',
    fileName,
    fileSize,
    mimeType,
    sha256,
    validationState: 'Unknown',
    manifestCount: 0,
    manifests: [],
    warnings: ['No C2PA manifest was found in this asset.']
  };
}

export function errorResult(
  fileName: string,
  fileSize: number,
  mimeType: string,
  sha256: string,
  error: unknown
): VerificationResult {
  return {
    status: 'error',
    fileName,
    fileSize,
    mimeType,
    sha256,
    validationState: 'Unknown',
    manifestCount: 0,
    manifests: [],
    warnings: [],
    error: error instanceof Error ? error.message : 'Unable to inspect this asset.'
  };
}
