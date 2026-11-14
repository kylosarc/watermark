/**
 * Provider verification status and cleanup-layer model.
 *
 * These are cited facts, not detections. Status claims follow the provider's
 * own documentation; the retrieval date is recorded so the data can go stale
 * visibly instead of silently.
 */

export type ProviderStatus =
  | 'supported'
  | 'partial'
  | 'provider-side'
  | 'not-documented'
  | 'unknown';

export type ProviderModality = 'Text' | 'Image' | 'Audio' | 'Video';

export interface ProviderModalityEntry {
  modality: ProviderModality;
  status: ProviderStatus;
  note?: string;
}

export interface ProviderSource {
  label: string;
  url: string;
}

export interface ProviderEntry {
  id: string;
  name: string;
  vendor: string;
  lastVerified: string;
  mechanism: string;
  publicVerification: string;
  localVerification: string;
  modalities: ProviderModalityEntry[];
  notes: string[];
  sources: ProviderSource[];
}

export const PROVIDER_STATUS_LABELS: Record<ProviderStatus, string> = {
  supported: 'Supported',
  partial: 'Partial',
  'provider-side': 'Provider-side only',
  'not-documented': 'Not documented',
  unknown: 'Unknown',
};

export const PROVIDER_STATUS_DESCRIPTIONS: Record<ProviderStatus, string> = {
  supported: 'Deployed and documented by the provider.',
  partial: 'Deployed for some products or surfaces, but not all.',
  'provider-side': 'The mark exists, but only the provider can verify it.',
  'not-documented': 'No primary-source evidence found. That absence is itself useful.',
  unknown: 'Not enough evidence to classify.',
};

export const PROVIDER_STATUS_SOURCE = {
  label: 'IsWatermarked? provider status table',
  url: 'https://iswatermarked.com/ai-watermark-status',
  retrievedAt: '2026-11-14',
  note:
    'Status rows and dates were cross-checked against the linked primary sources. Re-check the primary source before relying on a row.',
};

export const PROVIDERS: ProviderEntry[] = [
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    lastVerified: '2026-11-04',
    mechanism:
      'Statistical text watermark using a keyed version of the SynthID-Text approach, plus signed C2PA Content Credentials on supported files.',
    publicVerification:
      'Text: private-preview detection API for approved organisations. Files: Anthropic’s Claude Content Checker, or any conforming C2PA tool.',
    localVerification:
      'C2PA in supported images can be verified locally. The text watermark cannot be checked locally or by the public.',
    modalities: [
      { modality: 'Text', status: 'supported', note: 'Provider-side detection only' },
      { modality: 'Image', status: 'partial' },
      { modality: 'Audio', status: 'partial' },
      { modality: 'Video', status: 'partial' },
    ],
    notes: [
      'Anthropic says the text mark adds no hidden characters; it changes the randomness used to choose between equally good words.',
      'A detected mark can mean Claude processed the text — including proofreading, translation or summarization — not that Claude wrote every sentence.',
      'Anthropic states detection works poorly on short samples; confidence grows with passage length.',
      'Light editing is unlikely to remove the mark. A complete rewrite in which every word is replaced is the documented way to remove it.',
      'The mark is sparser on factual passages and exact code, where the model has fewer word choices.',
    ],
    sources: [
      {
        label: 'Anthropic — How Claude’s text watermarking works',
        url: 'https://www.anthropic.com/news/claude-text-watermark',
      },
      {
        label: 'Anthropic Help Center — How Claude marks AI-generated content',
        url: 'https://support.claude.com/en/articles/16266773-how-claude-marks-ai-generated-content',
      },
      {
        label: 'Claude API — Content Credentials on generated files',
        url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool#content-credentials-on-generated-files',
      },
      {
        label: 'Claude Content Checker',
        url: 'https://claude.com/check-content',
      },
      {
        label: 'Haimaker — Claude watermark removal guide (layered cleanup)',
        url: 'https://haimaker.ai/blog/claude-watermark-removal-guide/',
      },
    ],
  },
  {
    id: 'synthid',
    name: 'SynthID',
    vendor: 'Google DeepMind',
    lastVerified: '2026-08-20',
    mechanism:
      'Invisible statistical watermark per modality, plus C2PA adoption across Google products.',
    publicVerification:
      'Ask the Gemini app to check images, video or audio. Rollout is extending to Search and Chrome. The dedicated SynthID Detector portal is waitlist-only.',
    localVerification:
      'SynthID itself cannot be detected locally by anyone but Google. C2PA metadata can be verified here.',
    modalities: [
      { modality: 'Text', status: 'provider-side', note: 'No public text detector' },
      { modality: 'Image', status: 'supported' },
      { modality: 'Audio', status: 'supported' },
      { modality: 'Video', status: 'supported' },
    ],
    notes: [
      'Google reports watermarking over 100 billion images and videos and 60,000 years of audio (May 19, 2026).',
      'Anthropic’s Claude text watermark uses a version of DeepMind’s SynthID-Text approach.',
      'Consumer verification runs through Google surfaces, not a downloadable local detector.',
    ],
    sources: [
      { label: 'Google DeepMind — SynthID', url: 'https://deepmind.google/models/synthid/' },
      {
        label: 'Google — Identifying AI-generated media',
        url: 'https://blog.google/innovation-and-ai/products/identifying-ai-generated-media-online/',
      },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT / OpenAI',
    vendor: 'OpenAI',
    lastVerified: '2026-08-18',
    mechanism:
      'C2PA metadata plus a SynthID watermark on images; supported audio also carries SynthID.',
    publicVerification:
      'OpenAI’s Verify tool (public preview) checks uploaded images for C2PA and SynthID. There is no public tool that detects ChatGPT text.',
    localVerification:
      'C2PA in ChatGPT/API images can be verified here. The SynthID layer cannot.',
    modalities: [
      { modality: 'Text', status: 'not-documented', note: 'No deployed ChatGPT text watermark' },
      { modality: 'Image', status: 'supported' },
      { modality: 'Audio', status: 'partial' },
      { modality: 'Video', status: 'unknown' },
    ],
    notes: [
      'OpenAI joined C2PA; since May 2026, images generated through ChatGPT, Codex and the API carry C2PA plus SynthID.',
      'ChatGPT text output carries no deployed watermark, although OpenAI has researched text watermarking.',
      'Metadata can be stripped by platforms or edits.',
    ],
    sources: [
      {
        label: 'OpenAI — Advancing content provenance',
        url: 'https://openai.com/index/advancing-content-provenance/',
      },
    ],
  },
  {
    id: 'c2pa',
    name: 'C2PA / Content Credentials',
    vendor: 'Coalition for Content Provenance and Authenticity',
    lastVerified: '2026-08-18',
    mechanism:
      'Open standard: signed provenance manifests embedded in, or referenced by, media files.',
    publicVerification:
      'Fully public: any conforming tool can validate Content Credentials. Watermark uses the official CAI browser SDK locally.',
    localVerification:
      'Full local verification: manifest parsing, signature validation and provenance chain, powered by @contentauth/c2pa-web (WASM).',
    modalities: [
      { modality: 'Text', status: 'not-documented' },
      { modality: 'Image', status: 'supported' },
      { modality: 'Audio', status: 'supported' },
      { modality: 'Video', status: 'supported' },
    ],
    notes: [
      'C2PA is signed metadata travelling with the file, not a hidden watermark inside the content.',
      'Anyone can verify it; it can also be stripped or detached.',
      'Adopters include Anthropic, OpenAI, Google, Adobe, camera makers and phone makers.',
    ],
    sources: [
      { label: 'C2PA specification', url: 'https://spec.c2pa.org/' },
      {
        label: 'Content Authenticity Initiative — c2pa-js',
        url: 'https://opensource.contentauthenticity.org/docs/c2pa-js/',
      },
    ],
  },
  {
    id: 'adobe',
    name: 'Adobe Firefly / Creative Cloud',
    vendor: 'Adobe',
    lastVerified: '2026-08-18',
    mechanism: 'C2PA Content Credentials across Firefly outputs and Creative Cloud workflows.',
    publicVerification:
      'Content Credentials attached by Firefly and Creative Cloud are publicly verifiable with any C2PA tool.',
    localVerification: 'Full local C2PA verification, the same as any Content Credentials file.',
    modalities: [
      { modality: 'Text', status: 'not-documented' },
      { modality: 'Image', status: 'supported' },
      { modality: 'Audio', status: 'unknown' },
      { modality: 'Video', status: 'partial' },
    ],
    notes: [
      'Adobe co-founded the Content Authenticity Initiative.',
      'C2PA records claims and cryptographic relationships; it does not make every assertion true.',
    ],
    sources: [
      { label: 'Adobe Content Authenticity Initiative', url: 'https://contentauthenticity.org/' },
    ],
  },
];

export type VerificationLevelId =
  | 'verified'
  | 'detected'
  | 'not-detected'
  | 'unavailable'
  | 'inconclusive';

export interface VerificationLevel {
  id: VerificationLevelId;
  label: string;
  tone: 'good' | 'warn' | 'neutral' | 'muted';
  description: string;
}

/** Label vocabulary aligned with the bilateral evidence model. */
export const VERIFICATION_LEVELS: VerificationLevel[] = [
  {
    id: 'verified',
    label: 'Verified',
    tone: 'good',
    description:
      'A cryptographic validation succeeded, for example a C2PA signature over the asset.',
  },
  {
    id: 'detected',
    label: 'Detected signal',
    tone: 'warn',
    description:
      'A deterministic technical finding, such as hidden code points at named positions. It is a fact about the content, not a verdict about its author.',
  },
  {
    id: 'not-detected',
    label: 'Not detected',
    tone: 'neutral',
    description:
      'The specific checks performed found nothing. This is never proof that no watermark exists.',
  },
  {
    id: 'unavailable',
    label: 'Verification unavailable',
    tone: 'muted',
    description:
      'A mark may exist, but no public mechanism can check it. Claude and SynthID text watermarks currently fall here.',
  },
  {
    id: 'inconclusive',
    label: 'Inconclusive',
    tone: 'muted',
    description:
      'A parse error, unsupported input, or a heuristic result. Reported as inconclusive rather than as a negative.',
  },
];

export interface CleanupLayer {
  id: 'A' | 'B' | 'C';
  name: string;
  method: string;
  whatItDoes: string;
  evidence: string;
  limitation: string;
  deterministic: boolean;
}

/**
 * Layered cleanup model adapted from Haimaker's Claude watermark removal guide.
 * It deliberately separates deterministic cleanup from uncertifiable rewriting.
 */
export const CLEANUP_LAYERS: CleanupLayer[] = [
  {
    id: 'A',
    name: 'Unicode cleanup',
    method: 'Deterministic',
    whatItDoes:
      'Removes or normalizes zero-width characters, invisible formatting, look-alike spaces, bidi controls, tag characters and noncharacters.',
    evidence:
      'Verifiable by rescanning the exact code points before and after. The Hidden tab records counts and positions.',
    limitation:
      'Does not remove a statistical text watermark. Anthropic says Claude’s text mark adds no hidden characters at all.',
    deterministic: true,
  },
  {
    id: 'B',
    name: 'Statistical rewrite',
    method: 'Best-effort',
    whatItDoes:
      'Changes word choices through the Improve Text / Unslop tools or an external model. Full rewrites are the documented way to remove a SynthID-Text-style mark.',
    evidence:
      'The text changed and a diff can be recorded. That is not the same as proving the mark is gone.',
    limitation:
      'Anthropic’s detector is in private preview and Google has no public SynthID text detector. No local tool can certify removal against them.',
    deterministic: false,
  },
  {
    id: 'C',
    name: 'Container metadata',
    method: 'Deterministic for supported fields',
    whatItDoes:
      'Strips C2PA, EXIF, XMP, document properties and generator metadata from supported files in the Inspector / metadata tools.',
    evidence:
      'Verifiable for the fields and manifests that were actually removed.',
    limitation:
      'Does not touch text or soft-bound/pixel signals. A removed embedded manifest says nothing about a sidecar or a remote manifest link.',
    deterministic: true,
  },
];

export const RESIDUAL_RISKS: string[] = [
  'Claude’s statistical text mark and its private-preview detector.',
  'Google SynthID text, which has no public detector.',
  'Soft-bound provenance, sidecar manifests and remote manifest references.',
  'Pixel-level, audio and video watermarks that survive text or metadata cleanup.',
  'Future detector changes and provider-side keys that are not public.',
];

export interface CleanupSource {
  label: string;
  url: string;
  note: string;
}

export const CLEANUP_SOURCES: CleanupSource[] = [
  {
    label: 'Haimaker — How to Remove Claude Watermarks From Content You Own',
    url: 'https://haimaker.ai/blog/claude-watermark-removal-guide/',
    note:
      'Source of the three-layer model (Unicode → rewrite → container metadata) and the “verification has three confidence levels” framing. Third-party guide; cited for the model, not endorsed as a service.',
  },
  {
    label: 'IsWatermarked? — Hidden Character Checker',
    url: 'https://iswatermarked.com/hidden-character-checker',
    note:
      'Reference for the code-point groups, position reporting and the warning that hidden characters are not proof of AI.',
  },
  {
    label: 'IsWatermarked? — Methodology',
    url: 'https://iswatermarked.com/methodology',
    note:
      'Reference for the verification labels: Verified, Detected signal, Not detected, Verification unavailable and Inconclusive.',
  },
  {
    label: 'Anthropic — How Claude’s text watermarking works',
    url: 'https://www.anthropic.com/news/claude-text-watermark',
    note:
      'Primary source for the keyed SynthID-Text approach and the private-preview detection API.',
  },
];