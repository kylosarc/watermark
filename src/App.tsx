import { type DragEvent, useEffect, useRef, useState } from 'react';
import { verifyFile } from './lib/c2pa';
import { formatBytes } from './lib/file';
import type { ManifestSummary, ValidationCode, VerificationResult, VerificationStatus } from './lib/types';
import './styles.css';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*';

const STATUS_LABELS: Record<VerificationStatus, string> = {
  idle: 'Ready',
  loading: 'Verifying',
  ready: 'Credentials found',
  missing: 'No credentials found',
  invalid: 'Invalid credentials',
  error: 'Verification failed'
};

const STATUS_TONES: Record<VerificationStatus, string> = {
  idle: 'neutral',
  loading: 'info',
  ready: 'success',
  missing: 'warning',
  invalid: 'danger',
  error: 'danger'
};

function formatDate(value: string | undefined): string {
  if (!value) {
    return 'Not provided';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  return <span className={`status-badge ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}

function CodeList({ codes }: { codes: ValidationCode[] }) {
  if (codes.length === 0) {
    return <p className="muted">No detailed validation codes were returned.</p>;
  }

  return (
    <ul className="code-list">
      {codes.map((code, index) => (
        <li key={`${code.code}-${index}`}>
          <strong>{code.code}</strong>
          {code.explanation ? <span>{code.explanation}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ManifestCard({ manifest }: { manifest: ManifestSummary }) {
  return (
    <article className={`manifest-card ${manifest.isActive ? 'active' : ''}`}>
      <div className="manifest-heading">
        <div>
          <p className="eyebrow">{manifest.isActive ? 'Active manifest' : 'Ingredient manifest'}</p>
          <h3>{manifest.label}</h3>
        </div>
        {manifest.signatureAlgorithm ? <span className="algorithm">{manifest.signatureAlgorithm}</span> : null}
      </div>

      <dl className="detail-grid">
        <div><dt>Title</dt><dd>{manifest.title ?? 'Not provided'}</dd></div>
        <div><dt>Format</dt><dd>{manifest.format ?? 'Not provided'}</dd></div>
        <div><dt>Claim generator</dt><dd>{manifest.claimGenerator ?? 'Not provided'}</dd></div>
        <div><dt>Issuer</dt><dd>{manifest.issuer ?? 'Not provided'}</dd></div>
        <div><dt>Signed</dt><dd>{formatDate(manifest.signedAt)}</dd></div>
      </dl>

      <div className="manifest-columns">
        <section>
          <h4>Ingredients</h4>
          {manifest.ingredients.length > 0 ? <ul>{manifest.ingredients.map((ingredient, index) => <li key={`${ingredient}-${index}`}>{ingredient}</li>)}</ul> : <p className="muted">None listed.</p>}
        </section>
        <section>
          <h4>Assertions</h4>
          {manifest.assertions.length > 0 ? <ul>{manifest.assertions.map((assertion) => <li key={assertion}>{assertion}</li>)}</ul> : <p className="muted">None listed.</p>}
        </section>
      </div>

      <section className="validation-section">
        <h4>Validation</h4>
        <CodeList codes={manifest.validationCodes} />
      </section>
    </article>
  );
}

function ResultPanel({ result }: { result: VerificationResult }) {
  return (
    <section className="result-panel" aria-live="polite">
      <div className="result-header">
        <div>
          <p className="eyebrow">Inspected asset</p>
          <h2>{result.fileName}</h2>
        </div>
        <StatusBadge status={result.status} />
      </div>

      <dl className="detail-grid file-details">
        <div><dt>Size</dt><dd>{formatBytes(result.fileSize)}</dd></div>
        <div><dt>Type</dt><dd>{result.mimeType}</dd></div>
        <div><dt>SHA-256</dt><dd className="hash">{shortHash(result.sha256)}</dd></div>
        <div><dt>Validation state</dt><dd>{result.validationState}</dd></div>
      </dl>

      {result.error ? <div className="notice danger">{result.error}</div> : null}
      {result.warnings.length > 0 ? (
        <div className="notice warning">
          <strong>Important</strong>
          <ul>{result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        </div>
      ) : null}

      {result.manifestCount > 0 ? (
        <div className="manifest-list">
          <div className="section-heading">
            <h3>Content Credentials</h3>
            <span>{result.manifestCount} manifest{result.manifestCount === 1 ? '' : 's'}</span>
          </div>
          {result.manifests.map((manifest) => <ManifestCard key={manifest.label} manifest={manifest} />)}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No signed provenance found</h3>
          <p>This result does not mean the asset is human-made or AI-generated. It only means this file did not expose a C2PA manifest to the verifier.</p>
        </div>
      )}

      <p className="provenance-note">A valid signature establishes that a manifest was signed and bound to these bytes. It does not independently prove that every claim inside the manifest is true.</p>
    </section>
  );
}

export default function App() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsVerifying(true);
    setResult(null);
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    const nextPreview = file.type.startsWith('image/') ? window.URL.createObjectURL(file) : null;
    setPreviewUrl(nextPreview);
    const nextResult = await verifyFile(file);
    setResult(nextResult);
    setIsVerifying(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void handleFile(event.dataTransfer.files?.[0]);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local-first media intelligence</p>
          <h1>Watermark</h1>
          <p className="lede">Inspect C2PA Content Credentials, verify signatures, and understand media provenance without uploading the asset.</p>
        </div>
        <span className="local-badge">Local processing</span>
      </header>

      <section
        className={`drop-zone ${isVerifying ? 'is-busy' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <div>
          <h2>{isVerifying ? 'Verifying asset…' : 'Drop an image, audio, or video file'}</h2>
          <p>Supported C2PA formats include JPEG, PNG, WebP, HEIF, TIFF, MP4, MOV, and WAV. Files stay in your browser.</p>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={isVerifying}>
            {isVerifying ? 'Verifying' : 'Choose file'}
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>
      </section>

      {previewUrl ? (
        <section className="preview-panel">
          <p className="eyebrow">Preview</p>
          <img src={previewUrl} alt="Selected asset preview" />
        </section>
      ) : null}

      {result ? <ResultPanel result={result} /> : (
        <section className="intro-panel">
          <h2>What verification tells you</h2>
          <div className="intro-grid">
            <article><h3>Signature</h3><p>Checks whether the manifest signature is valid for the file bytes.</p></article>
            <article><h3>Issuer</h3><p>Shows the certificate issuer and distinguishes valid from trusted credentials.</p></article>
            <article><h3>Lineage</h3><p>Displays ingredients, assertions, and the active manifest in the provenance chain.</p></article>
          </div>
        </section>
      )}
    </main>
  );
}
