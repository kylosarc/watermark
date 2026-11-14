import { ExternalLink, ShieldCheck, ShieldOff, Sparkles } from 'lucide-react';
import type { TextItem } from '../../lib/textAnalysis';
import {
  PROVIDERS,
  PROVIDER_STATUS_DESCRIPTIONS,
  PROVIDER_STATUS_LABELS,
  PROVIDER_STATUS_SOURCE,
  VERIFICATION_LEVELS,
  type ProviderStatus,
  type VerificationLevelId,
} from '../../lib/providers';

function statusClass(status: ProviderStatus): string {
  return `provider-badge provider-status-${status}`;
}

function levelClass(level: VerificationLevelId): string {
  return `provider-check-level provider-level-${level}`;
}

function ProviderCard({
  provider,
  compact,
}: {
  provider: (typeof PROVIDERS)[number];
  compact: boolean;
}) {
  return (
    <article className={`provider-card ${compact ? 'compact' : ''}`}>
      <header className="provider-card-head">
        <div>
          <h4>{provider.name}</h4>
          <span>{provider.vendor}</span>
        </div>
        <span className="provider-verified">Verified {provider.lastVerified}</span>
      </header>

      <div className="provider-modalities">
        {provider.modalities.map((entry) => (
          <span
            key={`${provider.id}-${entry.modality}`}
            className={statusClass(entry.status)}
            title={entry.note ?? PROVIDER_STATUS_DESCRIPTIONS[entry.status]}
          >
            {entry.modality}: {PROVIDER_STATUS_LABELS[entry.status]}
          </span>
        ))}
      </div>

      <p className="provider-public">
        <strong>Public verification:</strong> {provider.publicVerification}
      </p>

      {!compact && (
        <>
          <div className="provider-section">
            <span>Mechanism</span>
            <p>{provider.mechanism}</p>
          </div>
          <div className="provider-section">
            <span>In Watermark</span>
            <p>{provider.localVerification}</p>
          </div>
          <ul className="provider-notes">
            {provider.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="provider-sources">
            {provider.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                {source.label} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function LocalChecks({ item }: { item?: TextItem | null }) {
  const c2pa = item?.c2paResult;
  const c2paLevel: VerificationLevelId = c2pa
    ? c2pa.validationState === 'Trusted' || c2pa.validationState === 'Valid'
      ? 'verified'
      : c2pa.status === 'ready'
        ? 'inconclusive'
        : 'not-detected'
    : 'inconclusive';
  const hiddenCount = item?.analysis?.hiddenSignalCount ?? 0;

  const checks: Array<{
    label: string;
    level: VerificationLevelId;
    detail: string;
  }> = [
    {
      label: 'C2PA signature',
      level: c2paLevel,
      detail: c2pa
        ? `${c2pa.status} · ${c2pa.validationState} · ${c2pa.manifestCount} manifest(s)`
        : 'No file selected in this text item.',
    },
    {
      label: 'Hidden Unicode',
      level: hiddenCount > 0 ? 'detected' : 'not-detected',
      detail:
        hiddenCount > 0
          ? `${hiddenCount} deterministic code-point signal(s) found.`
          : 'The code-point scan found nothing. Not proof of absence.',
    },
    {
      label: 'SHA-256 digest',
      level: item?.sha256 ? 'verified' : 'inconclusive',
      detail: item?.sha256
        ? 'Digest computed locally. A hash identifies bytes; it does not establish authorship.'
        : 'No item selected.',
    },
    {
      label: 'Claude / SynthID text mark',
      level: 'unavailable',
      detail: 'No public local detector exists. Provider-side verification only.',
    },
    {
      label: 'Style heuristic',
      level: 'inconclusive',
      detail: 'A writing-style estimate, not a watermark detector or authorship test.',
    },
  ];

  return (
    <div className="provider-checks">
      <h4>Local checks for this item</h4>
      <div className="provider-check-grid">
        {checks.map((check) => (
          <div key={check.label} className="provider-check">
            <div className="provider-check-head">
              <span className={levelClass(check.level)}>{check.level.replace('-', ' ')}</span>
              <strong>{check.label}</strong>
            </div>
            <p>{check.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerificationLabels() {
  return (
    <div className="provider-labels">
      <h4>How to read a result</h4>
      <div className="provider-label-grid">
        {VERIFICATION_LEVELS.map((level) => (
          <div key={level.id} className="provider-label">
            <span className={levelClass(level.id)}>{level.label}</span>
            <p>{level.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProviderStatusPanel({
  item,
  compact = false,
}: {
  item?: TextItem | null;
  compact?: boolean;
}) {
  return (
    <div className={`provider-panel ${compact ? 'compact' : ''}`}>
      <div className="provider-intro">
        <div>
          <h3>What can actually be verified?</h3>
          <p>
            Provider claims, cryptographic checks, deterministic code-point scans and style
            heuristics are different kinds of evidence. Watermark keeps them separate and
            never turns “not detected” into “clean” or “human”.
          </p>
        </div>
        <ShieldCheck size={28} />
      </div>

      {!compact && <LocalChecks item={item} />}
      {!compact && <VerificationLabels />}

      <div className="provider-grid">
        {PROVIDERS.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} compact={compact} />
        ))}
      </div>

      {!compact && (
        <p className="provider-source-note">
          Status source: <a href={PROVIDER_STATUS_SOURCE.url} target="_blank" rel="noreferrer">{PROVIDER_STATUS_SOURCE.label}</a>{' '}
          (retrieved {PROVIDER_STATUS_SOURCE.retrievedAt}). {PROVIDER_STATUS_SOURCE.note}
        </p>
      )}

      {compact && (
        <div className="provider-compact-note">
          <ShieldOff size={14} />
          <span>
            Text watermarks from Claude and SynthID are provider-side only. Hidden Unicode and
            C2PA are the checks this browser can perform.
          </span>
        </div>
      )}

      {!compact && (
        <div className="provider-heuristic-note">
          <Sparkles size={14} />
          <span>
            The style score in the Analysis tab is an experimental heuristic. It is not a
            provenance signal and should not be used as an authorship verdict.
          </span>
        </div>
      )}
    </div>
  );
}