import { useMemo, useState } from 'react';
import { Info, Search } from 'lucide-react';
import type { TextItem } from '../../lib/textAnalysis';
import {
  analyzeWriting,
  suggestSynonyms,
  type PovChoice,
  type PovId,
  type WritingHit,
} from '../../lib/writingAnalysis';

const POV_LABELS: Record<PovId, string> = {
  first: 'First person',
  second: 'Second person',
  third: 'Third person',
  mixed: 'Mixed',
  none: 'No pronouns found',
};

const POV_OPTIONS: { value: PovChoice; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'first', label: 'First person (I / we)' },
  { value: 'second', label: 'Second person (you)' },
  { value: 'third', label: 'Third person (he / she / they)' },
];

export function WritingPanel({
  item,
  onOptionsChange,
}: {
  item: TextItem;
  onOptionsChange: (options: { writingPov?: PovChoice; writingIgnoreDialogue?: boolean }) => void;
}) {
  const [includeStopWords, setIncludeStopWords] = useState(false);
  const [wordQuery, setWordQuery] = useState('');

  const analysis = useMemo(
    () => analyzeWriting(item.content, {
      pov: item.writingPov ?? 'auto',
      ignoreDialogue: item.writingIgnoreDialogue !== false,
    }),
    [item.content, item.writingPov, item.writingIgnoreDialogue],
  );

  const filteredWords = useMemo(() => {
    const source = includeStopWords ? analysis.frequencies : analysis.contentFrequencies;
    const query = wordQuery.trim().toLowerCase();
    return (query ? source.filter((entry) => entry.word.includes(query)) : source).slice(0, 200);
  }, [analysis.contentFrequencies, analysis.frequencies, includeStopWords, wordQuery]);

  const clicheCount = analysis.cliches[0]?.count ?? 0;
  const echoPairs = analysis.echoes.reduce((sum, echo) => sum + echo.count, 0);
  const dialoguePercent = Math.round(analysis.dialogue.dialogueRatio * 100);

  return (
    <div className="txt-results writing-panel">
      <div className="writing-head">
        <div>
          <h3>Writing analysis</h3>
          <p>
            POV shifts, tics, clichés, echoes, frequency and figurative-language candidates.
            These are revision prompts, not verdicts.
          </p>
        </div>
        <span className="writing-lexicon-badge" title="Built-in offline lexicons">
          local lexicons
        </span>
      </div>

      <div className="writing-stats">
        <WritingStat label="POV" value={POV_LABELS[analysis.pov.detected]} />
        <WritingStat label="POV anomalies" value={analysis.pov.anomalies.length} tone={analysis.pov.anomalies.length > 0 ? 'warning' : 'ok'} />
        <WritingStat label="Word echoes" value={echoPairs} tone={echoPairs > 0 ? 'warning' : 'ok'} />
        <WritingStat label="Clichés" value={clicheCount} tone={clicheCount > 0 ? 'warning' : 'ok'} />
        <WritingStat label="Similes" value={analysis.similes.count} />
        <WritingStat label="Metaphor candidates" value={analysis.metaphors.count} />
        <WritingStat label="Adverbs" value={`${analysis.adverbs.per1000.toFixed(1)}/1k`} />
        <WritingStat label="Dialogue" value={`${dialoguePercent}%`} />
      </div>

      {/* POV */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Point of view</h3>
            <p>Counts exclude quoted dialogue by default, because dialogue often uses other pronouns.</p>
          </div>
        </div>

        <div className="writing-pov-controls">
          <label>
            <span>Expected POV</span>
            <select
              value={item.writingPov ?? 'auto'}
              onChange={(e) => onOptionsChange({ writingPov: e.target.value as PovChoice })}
            >
              {POV_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="writing-check">
            <input
              type="checkbox"
              checked={item.writingIgnoreDialogue !== false}
              onChange={(e) => onOptionsChange({ writingIgnoreDialogue: e.target.checked })}
            />
            <span>Exclude quoted dialogue</span>
          </label>
        </div>

        <div className="writing-pov-counts">
          <span>First {analysis.pov.counts.first}</span>
          <span>Second {analysis.pov.counts.second}</span>
          <span>Third {analysis.pov.counts.third}</span>
          <span>Detected: <strong>{POV_LABELS[analysis.pov.detected]}</strong></span>
        </div>

        {analysis.pov.anomalies.length === 0 ? (
          <p className="writing-empty">
            {analysis.pov.detected === 'mixed'
              ? 'Pronoun use is mixed. Choose a POV above to scan for sentences that leave it.'
              : 'No sentences use a different POV class outside dialogue.'}
          </p>
        ) : (
          <div className="writing-anomalies">
            {analysis.pov.anomalies.map((anomaly) => (
              <div className="writing-anomaly" key={`${anomaly.sentenceIndex}-${anomaly.text}`}>
                <div className="writing-anomaly-meta">
                  <span>Sentence {anomaly.sentenceIndex}</span>
                  <span className="writing-anomaly-found">{anomaly.found.map((pov) => POV_LABELS[pov]).join(', ')}</span>
                  <span>expected {POV_LABELS[anomaly.expected]}</span>
                </div>
                <p>{anomaly.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Frequency */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Word frequency</h3>
            <p>
              {analysis.uniqueWords.toLocaleString()} unique words ·{' '}
              {analysis.uniqueContentWords.toLocaleString()} content words.
              The complete export includes every entry.
            </p>
          </div>
        </div>

        <div className="writing-frequency-controls">
          <label className="writing-search">
            <Search size={14} />
            <input
              type="search"
              placeholder="Filter words..."
              value={wordQuery}
              onChange={(e) => setWordQuery(e.target.value)}
            />
          </label>
          <label className="writing-check">
            <input
              type="checkbox"
              checked={includeStopWords}
              onChange={(e) => setIncludeStopWords(e.target.checked)}
            />
            <span>Include common words</span>
          </label>
        </div>

        <div className="writing-table-wrap">
          <table className="writing-table">
            <thead>
              <tr>
                <th>Word</th>
                <th>Count</th>
                <th>Per 1k</th>
                <th>Offline alternatives</th>
              </tr>
            </thead>
            <tbody>
              {filteredWords.map((entry) => {
                const suggestions = suggestSynonyms(entry.word).slice(0, 3);
                return (
                  <tr key={entry.word}>
                    <td className="writing-word">{entry.word}</td>
                    <td>{entry.count}</td>
                    <td>{entry.per1000.toFixed(1)}</td>
                    <td>
                      {suggestions.length === 0 ? (
                        <span className="writing-muted">—</span>
                      ) : (
                        <span className="writing-synonyms">
                          {suggestions.map((suggestion) => (
                            <span key={suggestion} className="writing-synonym">{suggestion}</span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredWords.length === 0 && (
                <tr>
                  <td colSpan={4} className="writing-muted">No words match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="writing-footnote">
          Synonyms are a small offline list, not a thesaurus. Check register, meaning and repetition before swapping.
        </p>
      </section>

      {/* Tics */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Tics &amp; habits</h3>
            <p>Crutches, filters, hedges, intensifiers, emotion telling and reaction clichés.</p>
          </div>
        </div>
        {analysis.tics.length === 0 ? (
          <p className="writing-empty">No matches from the built-in tic lists.</p>
        ) : (
          <div className="writing-hit-grid">
            {analysis.tics.map((entry) => <WritingHitCard key={entry.key} hit={entry} />)}
          </div>
        )}
      </section>

      {/* Dialogue */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Dialogue habits</h3>
            <p>Quote detection is approximate; it does not parse attributions or speaker changes.</p>
          </div>
        </div>
        <div className="writing-dialogue-stats">
          <WritingStat label="Dialogue share" value={`${dialoguePercent}%`} />
          <WritingStat label="Dialogue segments" value={analysis.dialogue.segments} />
          <WritingStat label="“said”" value={analysis.dialogue.said} />
          <WritingStat label="Said-bookisms" value={analysis.dialogue.saidBookisms.count} tone={analysis.dialogue.saidBookisms.count > 0 ? 'warning' : 'ok'} />
          <WritingStat label="Adverb tags" value={analysis.dialogue.adverbTags.count} tone={analysis.dialogue.adverbTags.count > 0 ? 'warning' : 'ok'} />
        </div>
        {analysis.dialogue.saidBookisms.count > 0 && <WritingHitCard hit={analysis.dialogue.saidBookisms} />}
        {analysis.dialogue.adverbTags.count > 0 && <WritingHitCard hit={analysis.dialogue.adverbTags} />}
      </section>

      {/* Clichés */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Clichés</h3>
            <p>Matched against a built-in list. A deliberate cliché is still a choice; this only counts it.</p>
          </div>
        </div>
        {analysis.cliches.length === 0 ? (
          <p className="writing-empty">No clichés from the built-in list.</p>
        ) : (
          <WritingHitCard hit={analysis.cliches[0]} />
        )}
      </section>

      {/* Figurative language */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Figurative language candidates</h3>
            <p>Pattern matches for “like a…”, “as … as…”, “as if…”, “was a…”. Grammar is not interpretation.</p>
          </div>
        </div>
        <div className="writing-figurative-grid">
          <div className="writing-figurative-card">
            <div className="writing-figurative-head">
              <strong>Similes</strong>
              <span>{analysis.similes.count}</span>
            </div>
            <WritingExamples examples={analysis.similes.examples} empty="No simile candidates found." />
          </div>
          <div className="writing-figurative-card">
            <div className="writing-figurative-head">
              <strong>Metaphor candidates</strong>
              <span>{analysis.metaphors.count}</span>
            </div>
            <WritingExamples examples={analysis.metaphors.examples} empty="No metaphor candidates found." />
          </div>
        </div>
      </section>

      {/* Echoes */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Word echoes</h3>
            <p>Content words repeated within 75 words. A useful echo is invisible; a distracting one isn’t.</p>
          </div>
        </div>
        {analysis.echoes.length === 0 ? (
          <p className="writing-empty">No nearby content-word echoes found.</p>
        ) : (
          <div className="writing-echo-list">
            {analysis.echoes.slice(0, 12).map((echo) => (
              <div className="writing-echo" key={echo.word}>
                <div className="writing-echo-head">
                  <strong>{echo.word}</strong>
                  <span>{echo.count} close repeat{echo.count === 1 ? '' : 's'}</span>
                </div>
                <div className="writing-echo-examples">
                  {echo.examples.map((example, index) => (
                    <p key={index}>
                      <span>{example.first}</span>
                      <em>→ {example.gap} words →</em>
                      <span>{example.second}</span>
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rhythm */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Sentence rhythm &amp; openers</h3>
            <p>{analysis.rhythm.total} sentences · {analysis.rhythm.average} words average · longest {analysis.rhythm.longest}.</p>
          </div>
        </div>
        <div className="writing-rhythm">
          {[
            ['Short (≤10)', analysis.rhythm.short],
            ['Medium (11–20)', analysis.rhythm.medium],
            ['Long (21–35)', analysis.rhythm.long],
            ['Very long (36+)', analysis.rhythm.veryLong],
          ].map(([label, count]) => (
            <div className="writing-bar-row" key={label as string}>
              <span>{label}</span>
              <div className="writing-bar">
                <div style={{ width: `${analysis.rhythm.total > 0 ? (Number(count) / analysis.rhythm.total) * 100 : 0}%` }} />
              </div>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
        <div className="writing-opener-block">
          <span className="writing-label">Repeated sentence openers</span>
          {analysis.repeatedOpeners.length === 0 ? (
            <span className="writing-muted">No opener repeats.</span>
          ) : (
            <div className="writing-chips">
              {analysis.repeatedOpeners.map((opener) => (
                <span className="writing-chip" key={opener.word}>
                  {opener.word} <strong>×{opener.count}</strong>
                </span>
              ))}
            </div>
          )}
          <span className="writing-muted">{analysis.conjunctionStarts} sentence(s) start with And/But/So/Because.</span>
        </div>
      </section>

      {/* Readability & word classes */}
      <section className="writing-section">
        <div className="writing-section-head">
          <div>
            <h3>Readability &amp; word class</h3>
            <p>Syllable counting is a heuristic; names and technical terms can skew all three scores.</p>
          </div>
        </div>
        <div className="writing-dialogue-stats">
          <WritingStat label="Flesch ease" value={analysis.readability.fleschReadingEase.toFixed(1)} />
          <WritingStat label="Flesch–Kincaid" value={`grade ${analysis.readability.fleschKincaidGrade.toFixed(1)}`} />
          <WritingStat label="Gunning Fog" value={analysis.readability.gunningFog.toFixed(1)} />
          <WritingStat label="Adverbs /1k" value={analysis.adverbs.per1000.toFixed(1)} tone={analysis.adverbs.per1000 > 20 ? 'warning' : 'ok'} />
          <WritingStat label="Nominalisations /1k" value={analysis.nominalizations.per1000.toFixed(1)} tone={analysis.nominalizations.per1000 > 30 ? 'warning' : 'ok'} />
        </div>
        <div className="writing-wordclass-grid">
          <div>
            <span className="writing-label">Top adverbs</span>
            <div className="writing-chips">
              {analysis.adverbs.top.length === 0 ? <span className="writing-muted">None found.</span> : analysis.adverbs.top.slice(0, 8).map((entry) => (
                <span className="writing-chip" key={entry.word}>{entry.word} <strong>×{entry.count}</strong></span>
              ))}
            </div>
          </div>
          <div>
            <span className="writing-label">Top nominalisations</span>
            <div className="writing-chips">
              {analysis.nominalizations.top.length === 0 ? <span className="writing-muted">None found.</span> : analysis.nominalizations.top.slice(0, 8).map((entry) => (
                <span className="writing-chip" key={entry.word}>{entry.word} <strong>×{entry.count}</strong></span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="writing-notes">
        <Info size={14} />
        <div>
          {analysis.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      </div>
    </div>
  );
}

function WritingStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'ok' | 'warning';
}) {
  return (
    <div className={`writing-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WritingHitCard({ hit }: { hit: WritingHit }) {
  return (
    <div className="writing-hit">
      <div className="writing-hit-head">
        <strong>{hit.label}</strong>
        <span>{hit.count}</span>
      </div>
      {hit.examples.length > 0 && (
        <div className="writing-hit-examples">
          {hit.examples.slice(0, 3).map((example, index) => (
            <p key={index}>{example}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function WritingExamples({ examples, empty }: { examples: string[]; empty: string }) {
  if (examples.length === 0) return <p className="writing-empty">{empty}</p>;
  return (
    <div className="writing-hit-examples">
      {examples.slice(0, 4).map((example, index) => (
        <p key={index}>{example}</p>
      ))}
    </div>
  );
}
