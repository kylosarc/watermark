import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  Download,
  EyeOff,
  FilePlus2,
  Info,
  ScanSearch,
  ShieldOff,
  Sparkles,
} from 'lucide-react';
import type { TextItem } from '../../lib/textAnalysis';
import {
  HIDDEN_CATEGORY_DEFS,
  cleanHiddenCharacters,
  defaultHiddenCleanOptions,
  scanHiddenCharacters,
  type HiddenCategoryId,
} from '../../lib/textForensics';
import {
  CLEANUP_LAYERS,
  CLEANUP_SOURCES,
  RESIDUAL_RISKS,
} from '../../lib/providers';
import { sha256Hex } from '../../lib/file';

export function UnicodeDetailPanel({
  item,
  showToast,
  onAddCleaned,
  onOpenTransform,
}: {
  item: TextItem;
  showToast: (msg: string) => void;
  onAddCleaned: (text: string, fileName: string) => void;
  onOpenTransform?: () => void;
}) {
  const [enabled, setEnabled] = useState<Record<HiddenCategoryId, boolean>>(
    () => defaultHiddenCleanOptions(),
  );
  const [copied, setCopied] = useState(false);
  const [hashes, setHashes] = useState<{ before: string; after: string } | null>(null);

  useEffect(() => {
    setEnabled(defaultHiddenCleanOptions());
    setHashes(null);
  }, [item.id]);

  const scan = useMemo(() => scanHiddenCharacters(item.content), [item.content]);
  const cleanResult = useMemo(
    () => cleanHiddenCharacters(item.content, enabled),
    [item.content, enabled],
  );

  useEffect(() => {
    let cancelled = false;
    if (cleanResult.totalChanged === 0) {
      setHashes(null);
      return;
    }
    Promise.all([
      sha256Hex(new Blob([item.content], { type: 'text/plain' })),
      sha256Hex(new Blob([cleanResult.text], { type: 'text/plain' })),
    ])
      .then(([before, after]) => {
        if (!cancelled) setHashes({ before, after });
      })
      .catch(() => {
        if (!cancelled) setHashes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.content, cleanResult.text, cleanResult.totalChanged]);

  const grouped = HIDDEN_CATEGORY_DEFS.map((def) => ({
    def,
    findings: scan.findings.filter((finding) => finding.category === def.id),
  })).filter((group) => group.findings.length > 0);

  const activeCategories = HIDDEN_CATEGORY_DEFS.filter(
    (def) => scan.byCategory[def.id] > 0 && enabled[def.id],
  );

  function toggleCategory(id: HiddenCategoryId) {
    setEnabled((current) => ({ ...current, [id]: !current[id] }));
  }

  function copyCleaned() {
    if (!cleanResult.text) return;
    navigator.clipboard?.writeText(cleanResult.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    showToast('Cleaned text copied');
  }

  function downloadCleaned() {
    const blob = new Blob([cleanResult.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleaned-${item.fileName ?? 'text'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addCleaned() {
    onAddCleaned(cleanResult.text, `cleaned-${item.fileName ?? 'pasted-text'}`);
  }

  return (
    <div className="txt-results">
      <div className="uni-summary">
        <div className="uni-summary-head">
          <div className="uni-summary-icon">
            <ScanSearch size={24} />
          </div>
          <div>
            <h3>Hidden Unicode Inspector</h3>
            <p>
              Deterministic, character-by-character scan. Same input, same output. It
              reports code points and positions; it does not guess authorship.
            </p>
          </div>
          <div className="uni-summary-total">
            <strong>{scan.totalSignals}</strong>
            <span>signals</span>
          </div>
        </div>

        <div className="uni-summary-stats">
          <div>
            <span>Unique code points</span>
            <strong>{scan.uniqueCodePoints}</strong>
          </div>
          <div>
            <span>Normalization</span>
            <strong>{scan.normalization.form}</strong>
          </div>
          <div>
            <span>Combining marks</span>
            <strong>{scan.normalization.combiningMarks}</strong>
          </div>
          <div>
            <span>Characters</span>
            <strong>{scan.characterCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Non-ASCII</span>
            <strong>{scan.nonAsciiCharacters.toLocaleString()}</strong>
          </div>
        </div>

        {scan.totalSignals === 0 ? (
          <div className="uni-none">
            <CheckCircle2 size={18} />
            <div>
              <strong>No hidden Unicode signals found by this scan.</strong>
              <span>
                This is a “not detected” result for these exact code-point checks. It is not
                proof that no watermark exists: Claude and SynthID text watermarks are
                statistical and cannot be read locally.
              </span>
            </div>
          </div>
        ) : (
          <div className="uni-summary-note">
            <Info size={14} />
            <span>
              Hidden characters are a fact about the text, not proof of AI. Word processors,
              chat apps, PDFs and websites insert them too. Regularly spaced markers are more
              interesting than a single stray no-break space.
            </span>
          </div>
        )}
      </div>

      {scan.totalSignals > 0 && (
        <div className="uni-categories">
          <div className="uni-section-head">
            <div>
              <h3>Choose what to clean</h3>
              <p>Only ticked categories are changed. Unusual spaces become ordinary spaces.</p>
            </div>
            <div className="uni-category-actions">
              <button
                className="action-tactile button-ghost"
                type="button"
                onClick={() => setEnabled(defaultHiddenCleanOptions())}
              >
                Defaults
              </button>
              <button
                className="action-tactile button-ghost"
                type="button"
                onClick={() => {
                  const all = {} as Record<HiddenCategoryId, boolean>;
                  for (const def of HIDDEN_CATEGORY_DEFS) all[def.id] = true;
                  setEnabled(all);
                }}
              >
                Select all
              </button>
              <button
                className="action-tactile button-ghost"
                type="button"
                onClick={() => {
                  const none = {} as Record<HiddenCategoryId, boolean>;
                  for (const def of HIDDEN_CATEGORY_DEFS) none[def.id] = false;
                  setEnabled(none);
                }}
              >
                None
              </button>
            </div>
          </div>

          <div className="uni-category-grid">
            {HIDDEN_CATEGORY_DEFS.map((def) => {
              const count = scan.byCategory[def.id];
              if (count === 0) return null;
              return (
                <label
                  key={def.id}
                  className={`uni-category ${enabled[def.id] ? 'active' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={enabled[def.id]}
                    onChange={() => toggleCategory(def.id)}
                  />
                  <div>
                    <div className="uni-category-title">
                      <strong>{def.label}</strong>
                      <span>{count}×</span>
                    </div>
                    <p>{def.description}</p>
                    {def.warning && (
                      <span className="uni-category-warning">
                        <AlertTriangle size={11} /> {def.warning}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {grouped.length > 0 && (
        <div className="uni-findings">
          <div className="uni-section-head">
            <div>
              <h3>Findings by code point</h3>
              <p>
                Positions are UTF-16 offsets with 1-based line and column. Occurrence lists
                are capped at 500 per code point.
              </p>
            </div>
            <span className="uni-badge">
              <EyeOff size={12} /> {scan.totalSignals} occurrences
            </span>
          </div>

          {grouped.map(({ def, findings }) => (
            <div key={def.id} className="uni-finding-group">
              <div className="uni-finding-group-head">
                <span>{def.label}</span>
                <strong>{scan.byCategory[def.id]}×</strong>
              </div>
              {findings.map((finding) => {
                const lines = Array.from(
                  new Set(finding.occurrences.map((occurrence) => occurrence.line)),
                );
                const first = finding.occurrences[0];
                return (
                  <div key={finding.codePoint} className="uni-finding">
                    <code className="uni-code">{finding.codePointLabel}</code>
                    <div className="uni-finding-main">
                      <div className="uni-finding-title">
                        <strong>{finding.name}</strong>
                        <span className="uni-count">×{finding.count}</span>
                        {finding.occurrencesTruncated && (
                          <span className="uni-truncated">positions capped</span>
                        )}
                      </div>
                      <div className="uni-context" title={first?.context ?? ''}>
                        {first?.context || '—'}
                      </div>
                      <div className="uni-positions">
                        {first
                          ? `first at line ${first.line}, column ${first.column} (offset ${first.index})`
                          : 'no position recorded'}
                        {lines.length > 1
                          ? ` · lines ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? '…' : ''}`
                          : ''}
                      </div>
                    </div>
                    <code className="uni-escaped">{finding.escaped}</code>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="uni-clean">
        <div className="uni-clean-head">
          <div>
            <h3>Layer A — deterministic cleanup</h3>
            <p>
              {cleanResult.totalChanged > 0
                ? `${cleanResult.totalChanged} character(s) will change. ${activeCategories.length} category(ies) selected.`
                : 'Nothing selected will change.'}
            </p>
          </div>
          <div className="uni-clean-actions">
            <button
              className="action-tactile button-ghost"
              type="button"
              onClick={copyCleaned}
              disabled={cleanResult.totalChanged === 0}
            >
              {copied ? <Clipboard size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy cleaned'}
            </button>
            <button
              className="action-tactile button-ghost"
              type="button"
              onClick={downloadCleaned}
              disabled={cleanResult.totalChanged === 0}
            >
              <Download size={14} /> Download
            </button>
            <button
              className="action-tactile button-primary"
              type="button"
              onClick={addCleaned}
              disabled={cleanResult.totalChanged === 0}
            >
              <FilePlus2 size={14} /> Add cleaned as new item
            </button>
          </div>
        </div>

        {cleanResult.totalChanged > 0 && (
          <div className="uni-clean-grid">
            <div className="uni-clean-stat">
              <span>Before</span>
              <strong>{cleanResult.before.totalSignals} signals</strong>
              <code>{hashes ? hashes.before.slice(0, 16) : 'calculating…'}…</code>
            </div>
            <div className="uni-clean-stat">
              <span>After</span>
              <strong>{cleanResult.after.totalSignals} signals</strong>
              <code>{hashes ? hashes.after.slice(0, 16) : 'calculating…'}…</code>
            </div>
            <div className="uni-clean-stat wide">
              <span>Changed by category</span>
              <strong>
                {HIDDEN_CATEGORY_DEFS.filter(
                  (def) => cleanResult.removed[def.id] > 0 || cleanResult.replaced[def.id] > 0,
                )
                  .map((def) => {
                    const removed = cleanResult.removed[def.id];
                    const replaced = cleanResult.replaced[def.id];
                    return `${def.label}: ${replaced > 0 ? `${replaced} replaced` : `${removed} removed`}`;
                  })
                  .join(' · ') || '—'}
              </strong>
            </div>
          </div>
        )}
      </div>

      <div className="uni-layers">
        <div className="uni-section-head">
          <div>
            <h3>Layered cleanup — what this can and cannot do</h3>
            <p>
              Adapted from the three-layer model in Haimaker’s Claude watermark removal guide.
              Each layer has a different confidence level.
            </p>
          </div>
        </div>

        <div className="uni-layer-grid">
          {CLEANUP_LAYERS.map((layer) => (
            <div key={layer.id} className={`uni-layer ${layer.deterministic ? 'deterministic' : 'best-effort'}`}>
              <div className="uni-layer-head">
                <span className="uni-layer-id">Layer {layer.id}</span>
                <span className="uni-layer-method">{layer.method}</span>
              </div>
              <h4>{layer.name}</h4>
              <p>{layer.whatItDoes}</p>
              <div className="uni-layer-evidence">
                <CheckCircle2 size={12} /> {layer.evidence}
              </div>
              <div className="uni-layer-limit">
                <ShieldOff size={12} /> {layer.limitation}
              </div>
              {layer.id === 'B' && onOpenTransform && (
                <button
                  className="action-tactile button-ghost"
                  type="button"
                  onClick={onOpenTransform}
                >
                  <Sparkles size={13} /> Open Improve Text
                </button>
              )}
              {layer.id === 'C' && (
                <span className="uni-layer-note">
                  {item.source === 'file'
                    ? 'Use the Inspector or metadata tools on the original file.'
                    : 'Not applicable to pasted text.'}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="uni-risks">
          <strong>Residual risk after cleanup</strong>
          <ul>
            {RESIDUAL_RISKS.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>

        <div className="uni-sources">
          {CLEANUP_SOURCES.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.note}>
              {source.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}