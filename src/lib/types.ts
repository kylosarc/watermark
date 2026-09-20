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
  claimVersion?: number;
  ingredients: string[];
  assertions: string[];
  validationCodes: ValidationCode[];
  // C2PA 2.2+ soft binding
  softBinding?: { algorithm: string; value: string }[];
  // Signature chain details
  signatureInfo?: {
    issuer?: string;
    commonName?: string;
    notBefore?: string;
    notAfter?: string;
    serialNumber?: string;
    digestAlgorithm?: string;
  };
  // AI generation signals
  digitalSourceType?: string;
  isAIGenerated?: boolean;
  // SynthID / watermark claims
  watermarkClaims?: string[];
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
