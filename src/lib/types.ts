export type VerificationStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'invalid' | 'error';

export type ValidationState = 'Trusted' | 'Valid' | 'Invalid' | 'Unknown';

export interface ValidationCode {
  code: string;
  explanation?: string;
  success?: boolean;
  url?: string;
}

export interface ManifestSummary {
  label: string;
  isActive: boolean;
  title?: string;
  format?: string;
  claimGenerator?: string;
  issuer?: string;
  signatureAlgorithm?: string;
  signedAt?: string;
  ingredients: string[];
  assertions: string[];
  validationCodes: ValidationCode[];
}

export interface VerificationResult {
  status: VerificationStatus;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  validationState: ValidationState;
  manifestCount: number;
  activeManifest?: string;
  manifests: ManifestSummary[];
  warnings: string[];
  error?: string;
}
