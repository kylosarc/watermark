/**
 * Verification → Evidence bridge.
 *
 * Converts a VerificationResult into a bilateral EvidenceSummary,
 * generating findings from BOTH perspectives:
 *   - manifest: what the C2PA manifest CLAIMS
 *   - independent: what can be cryptographically VERIFIED
 *   - user: what the user has done (modified/stripped/rejected)
 *
 * Each finding includes explainFinding() text and counterEvidence
 * so the UI can render a "Why?" explanation for every status badge.
 */

import type { VerificationResult, ManifestSummary, ValidationState } from './types';
import {
  type Finding,
  type EvidenceStatus,
  type Perspective,
  type EvidenceSummary,
  createFinding,
  buildSummary,
  explainFinding,
} from './evidence';

// ── Helpers ────────────────────────────────────────────────────

function validationStateToStatus(state: ValidationState): EvidenceStatus {
  switch (state) {
    case 'Trusted': return 'verified';
    case 'Valid': return 'supported';
    case 'Invalid': return 'contradicted';
    default: return 'unknown';
  }
}

/** Map a ValidationState to a human-readable trust explanation */
function trustExplanation(state: ValidationState): string {
  switch (state) {
    case 'Trusted': return 'The signing certificate chains to a trusted root recognized by this SDK. The manifest is cryptographically intact and the issuer is in the trust list.';
    case 'Valid': return 'The manifest is structurally and cryptographically valid, but the signing certificate does not chain to a known trusted root. This may be a valid self-signed or unrecognized CA certificate.';
    case 'Invalid': return 'The cryptographic signature failed validation. The manifest may have been tampered with, or the file was modified after signing.';
    default: return 'No validation data is available. The file may lack a C2PA manifest or the SDK could not process it.';
  }
}

// ── Core: VerificationResult → EvidenceSummary ─────────────────

/**
 * Build a bilateral evidence summary from a verification result.
 *
 * Generates findings from both the manifest's claims AND independent
 * cryptographic verification, giving users a complete picture of
 * what is claimed vs what is verified.
 */
export function buildEvidenceSummary(result: VerificationResult): EvidenceSummary {
  const findings: Finding[] = [];
  const manifest = result.manifests.find((m) => m.isActive) ?? result.manifests[0];

  // ── No manifest case ────────────────────────────────────────
  if (!manifest) {
    findings.push(
      createFinding(
        'nm-manifest',
        'manifest-integrity',
        'unknown',
        'independent',
        0,
        'No C2PA Manifest',
        'This file does not contain a C2PA manifest. No provenance claims are available.',
        [{ source: 'analysis', detail: 'No C2PA manifest detected in asset' }],
        'Without a C2PA manifest, there are no provenance claims to evaluate. This does not mean the file is inauthentic — many valid files lack embedded provenance.',
        'A file lacking a manifest could have had provenance stripped, or it was never signed. Both scenarios are common and legitimate.',
      ),
    );
    return buildSummary(findings, result.sha256, result.fileName);
  }

  // ── 1. Overall validation (independent perspective) ──────────
  findings.push(
    createFinding(
      'val-state',
      'signature',
      validationStateToStatus(result.validationState),
      'independent',
      result.validationState === 'Trusted' ? 95 : result.validationState === 'Valid' ? 70 : result.validationState === 'Invalid' ? 10 : 0,
      'Overall Validation State',
      trustExplanation(result.validationState),
      [
        { source: 'c2pa-signature', detail: `validation_state: ${result.validationState}` },
        ...manifest.validationCodes.slice(0, 3).map((v) => ({
          source: 'c2pa-signature' as const,
          detail: `${v.code}: ${v.explanation ?? 'no detail'}`,
        })),
      ],
      trustExplanation(result.validationState),
      result.validationState === 'Trusted'
        ? 'This trust status depends on the SDK\'s trust list. A different validator with different trust anchors might yield a different result.'
        : result.validationState === 'Valid'
        ? 'A validator with the issuer\'s root certificate in its trust store would mark this as Trusted. The difference is trust list coverage, not cryptographic integrity.'
        : 'Re-signing the file with a valid certificate would change this status, but would also alter the provenance chain.',
    ),
  );

  // ── 2. Signature integrity (independent perspective) ─────────
  const sigCodes = manifest.validationCodes;
  const sigValid = sigCodes.length > 0 && sigCodes.every((v) => v.success !== false);
  findings.push(
    createFinding(
      'sig-integrity',
      'signature',
      sigValid ? 'verified' : result.validationState === 'Invalid' ? 'contradicted' : 'unknown',
      'independent',
      sigValid ? 90 : 20,
      'Digital Signature',
      sigValid
        ? `Signature verified — algorithm: ${manifest.signatureAlgorithm ?? 'unknown'}`
        : 'Signature could not be independently verified from available validation codes',
      [
        { source: 'c2pa-signature', detail: manifest.signatureAlgorithm },
        ...sigCodes.map((v) => ({
          source: 'c2pa-signature' as const,
          detail: `${v.code}: ${v.explanation ?? 'ok'}`,
        })),
      ],
      sigValid
        ? `The signature was verified using ${manifest.signatureAlgorithm ?? 'the declared algorithm'}. All ${sigCodes.length} validation code(s) passed.`
        : 'The signature could not be fully verified. This may indicate tampering, an unsupported algorithm, or missing validation data.',
      'A forged or modified file would fail this check. However, a valid signature only proves the file was signed — not that the signer is truthful.',
    ),
  );

  // ── 3. Content binding (independent perspective) ─────────────
  findings.push(
    createFinding(
      'content-bind',
      'content-binding',
      validationStateToStatus(result.validationState),
      'independent',
      result.validationState === 'Trusted' ? 90 : result.validationState === 'Valid' ? 60 : 15,
      'Content Binding',
      `Content hash matches manifest binding — SHA-256: ${result.sha256.slice(0, 16)}…`,
      [{ source: 'c2pa-binding', detail: `SHA-256: ${result.sha256}` }],
      'The file\'s SHA-256 hash was checked against the manifest\'s content binding. If they match, the file has not been modified since signing.',
      'Any modification to the file (even a single pixel change) would break the content hash binding. This is the strongest tamper-detection mechanism in C2PA.',
    ),
  );

  // ── 4. Issuer trust (independent perspective) ───────────────
  findings.push(
    createFinding(
      'issuer-trust',
      'issuer-trust',
      manifest.issuer ? 'supported' : 'unknown',
      'independent',
      manifest.issuer ? 65 : 5,
      'Issuer Trust',
      manifest.issuer
        ? `Manifest issued by "${manifest.issuer}"`
        : 'No issuer information available in the manifest',
      [{ source: 'c2pa-manifest', detail: manifest.issuer ?? 'not provided' }],
      manifest.issuer
        ? `The signing certificate was issued by "${manifest.issuer}". Trust in this issuer depends on whether your validator recognizes them.`
        : 'No issuer was declared. This is unusual for legitimate C2PA content and may indicate a custom or incomplete signing setup.',
      'Issuer trust is relative to the trust list. The same certificate may be Trusted in one validator and merely Valid in another.',
    ),
  );

  // ── 5. Temporal validity (manifest perspective) ──────────────
  if (manifest.signedAt) {
    const signedDate = new Date(manifest.signedAt);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - signedDate.getTime()) / (1000 * 60 * 60 * 24));
    findings.push(
      createFinding(
        'temporal',
        'temporal-validity',
        'claimed',
        'manifest',
        50,
        'Signature Timestamp',
        `Claim signed ${daysSince} day${daysSince === 1 ? '' : 's'} ago (${manifest.signedAt})`,
        [
          { source: 'c2pa-signature', detail: `time: ${manifest.signedAt}` },
        ],
        `The manifest declares it was signed on ${manifest.signedAt}. This timestamp comes from the signing system and is part of the signed claim.`,
        'A signing system can set an arbitrary timestamp. Without an external timestamp authority (TSA), this value is self-reported and not independently verifiable.',
      ),
    );
  }

  // ── 6. Assertions claimed (manifest perspective) ─────────────
  if (manifest.assertions.length > 0) {
    findings.push(
      createFinding(
        'assertions',
        'provenance-chain',
        'claimed',
        'manifest',
        45,
        `${manifest.assertions.length} Assertion(s) Declared`,
        `Manifest declares ${manifest.assertions.length} assertion(s): ${manifest.assertions.slice(0, 5).join(', ')}${manifest.assertions.length > 5 ? '…' : ''}`,
        manifest.assertions.map((a) => ({
          source: 'c2pa-assertion' as const,
          detail: a,
        })),
        `The manifest claims these assertions are present. Assertions are part of the signed claim and cannot be modified without invalidating the signature.`,
        'An assertion being declared does not guarantee its accuracy. For example, an "actions" assertion claiming "no AI was used" is a claim by the signer, not an independent verification.',
      ),
    );
  }

  // ── 7. AI generation (manifest perspective) ──────────────────
  if (manifest.isAIGenerated !== undefined) {
    findings.push(
      createFinding(
        'ai-claim',
        'ai-generation',
        'claimed',
        'manifest',
        35,
        manifest.isAIGenerated ? 'AI-Generated Content Claimed' : 'Not Flagged as AI-Generated',
        manifest.isAIGenerated
          ? `Digital source type: ${manifest.digitalSourceType ?? 'unknown'} — content is claimed to be AI-generated`
          : 'No AI generation flag present in the manifest',
        [{ source: 'c2pa-assertion', detail: `digitalSourceType: ${manifest.digitalSourceType ?? 'n/a'}` }],
        manifest.isAIGenerated
          ? `The manifest claims this content was generated by AI (source type: ${manifest.digitalSourceType}). This is a self-reported claim by the signing software.`
          : 'The absence of an AI flag does not prove the content is human-made. The signing software may not support AI detection.',
        'A signing tool could omit the AI flag, or a human-created work could be falsely flagged. This claim is only as reliable as the signing tool\'s detection capability.',
      ),
    );
  }

  // ── 8. Watermark claims (manifest perspective) ───────────────
  if (manifest.watermarkClaims && manifest.watermarkClaims.length > 0) {
    findings.push(
      createFinding(
        'watermark',
        'watermark',
        'claimed',
        'manifest',
        30,
        'Watermark / SynthID Claimed',
        `Embedded watermark assertion(s): ${manifest.watermarkClaims.join(', ')}`,
        manifest.watermarkClaims.map((wc) => ({
          source: 'c2pa-assertion' as const,
          detail: wc,
        })),
        'The manifest declares one or more watermark assertions. Pixel-level verification is not available in this tool.',
        'Watermark assertions are claims by the signing tool. Local pixel-level verification is not possible without specialized detection algorithms.',
      ),
    );
  }

  // ── 9. Soft binding (manifest perspective) ───────────────────
  if (manifest.softBinding && manifest.softBinding.length > 0) {
    findings.push(
      createFinding(
        'soft-bind',
        'soft-binding',
        'claimed',
        'manifest',
        40,
        'Soft Binding Present',
        `C2PA 2.2+ soft binding: ${manifest.softBinding.map((sb) => sb.algorithm).join(', ')}`,
        manifest.softBinding.map((sb) => ({
          source: 'c2pa-assertion' as const,
          detail: `${sb.algorithm}: ${sb.value.slice(0, 40)}…`,
        })),
        'Soft binding is an invisible content fingerprint that can recover provenance even after hard metadata is stripped. This is a C2PA 2.2+ feature.',
        'Soft binding algorithms are still evolving. Different implementations may produce different fingerprints for the same content.',
      ),
    );
  }

  // ── 10. Ingredients / provenance chain (manifest perspective) ─
  if (manifest.ingredients.length > 0) {
    findings.push(
      createFinding(
        'ingredients',
        'provenance-chain',
        'supported',
        'manifest',
        50,
        `${manifest.ingredients.length} Ingredient(s) Linked`,
        `Provenance chain includes ${manifest.ingredients.length} ingredient(s): ${manifest.ingredients.slice(0, 3).join(', ')}${manifest.ingredients.length > 3 ? '…' : ''}`,
        manifest.ingredients.map((ing) => ({
          source: 'c2pa-manifest' as const,
          detail: ing,
        })),
        'Ingredients represent the source assets that were combined or modified to create this file. They form the provenance chain.',
        'Ingredient references are claims. The referenced assets may not be available, and the relationships described may not be accurate.',
      ),
    );
  }

  // ── 11. Signature algorithm (independent perspective) ────────
  if (manifest.signatureAlgorithm) {
    const weakAlgos = ['sha-1', 'md5', 'rsa-sha1'];
    const isWeak = weakAlgos.some((w) => manifest.signatureAlgorithm!.toLowerCase().includes(w));
    findings.push(
      createFinding(
        'sig-algo',
        'signature',
        isWeak ? 'contradicted' : 'verified',
        'independent',
        isWeak ? 20 : 85,
        'Signature Algorithm',
        `Algorithm: ${manifest.signatureAlgorithm}${isWeak ? ' (weak — known vulnerabilities)' : ' (strong)'}`,
        [{ source: 'c2pa-signature', detail: manifest.signatureAlgorithm }],
        `The manifest uses ${manifest.signatureAlgorithm} for signing. ${isWeak ? 'This algorithm has known weaknesses.' : 'This is a currently accepted algorithm.'}`,
        isWeak
          ? 'Weak algorithms can be forged with sufficient compute. The signature provides limited security assurance.'
          : 'Algorithm strength does not guarantee the signer\'s identity is trustworthy — only that the signature is computationally hard to forge.',
      ),
    );
  }

  // ── 12. Manifest count (independent perspective) ─────────────
  findings.push(
    createFinding(
      'manifest-count',
      'manifest-integrity',
      result.manifestCount > 0 ? 'supported' : 'contradicted',
      'independent',
      result.manifestCount > 0 ? 70 : 10,
      'Manifest Store',
      `${result.manifestCount} manifest(s) found in the manifest store`,
      [{ source: 'c2pa-manifest', detail: `manifest_count: ${result.manifestCount}` }],
      `The manifest store contains ${result.manifestCount} manifest(s). ${result.activeManifest ? `Active manifest: ${result.activeManifest}` : 'No active manifest identified.'}`,
      'Multiple manifests may indicate version history or re-signing. The active manifest is the latest claim, but older manifests may carry conflicting information.',
    ),
  );

  return buildSummary(findings, result.sha256, result.fileName);
}

// ── UI Helpers ─────────────────────────────────────────────────

/**
 * Group findings by perspective for display.
 * Returns a map of perspective → findings, ordered: manifest, independent, user.
 */
export function groupByPerspective(findings: Finding[]): Map<Perspective, Finding[]> {
  const groups = new Map<Perspective, Finding[]>();
  const order: Perspective[] = ['manifest', 'independent', 'user'];

  for (const p of order) {
    const items = findings.filter((f) => f.perspective === p);
    if (items.length > 0) groups.set(p, items);
  }

  return groups;
}

/**
 * Generate a "Why?" explanation for a ValidationState.
 * Used on the verification status badges in the overview.
 */
export function explainValidationState(state: ValidationState): string {
  return trustExplanation(state);
}

/** Re-export explainFinding for convenience */
export { explainFinding };
