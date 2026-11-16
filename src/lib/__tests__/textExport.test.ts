import { describe, expect, it } from 'vitest';
import { analyzeText, type TextItem } from '../textAnalysis';
import {
  TEXT_REPORT_SCHEMA,
  buildCompleteTextReport,
  buildCompleteTextReportCSV,
} from '../textExport';

const TEXT =
  'The model was trained on a large corpus. The model was trained to be helpful.\n' +
  'Alice met Bob in Paris.\u200B The model was trained again.';

function makeItem(overrides: Partial<TextItem> = {}): TextItem {
  const analysis = {
    ...analyzeText(TEXT),
    nlpSentiment: 0.25,
    nlpSentenceCount: 3,
    nlpTokenCount: 24,
    posDistribution: { NOUN: 5, VERB: 4, PROPN: 2 },
    entities: [{ text: 'Alice', type: 'PERSON' }, { text: 'Paris', type: 'GPE' }],
    sentenceSentiments: [0.1, -0.2, 0.4],
    adjectiveDensity: 4.2,
    nounDensity: 29.1,
    passiveEstimate: 12,
    pronounRatio: 4.2,
    entityDensity: 0.67,
  };

  return {
    id: 1,
    source: 'file',
    fileName: 'notes.txt',
    content: TEXT,
    c2paResult: null,
    sha256: 'abc123',
    analysis,
    status: 'done',
    format: 'txt',
    ...overrides,
  };
}

describe('buildCompleteTextReport', () => {
  it('includes every analysis area in a readable flat text report', () => {
    const report = buildCompleteTextReport([makeItem()]);

    expect(report).toContain('WATERMARK - COMPLETE TEXT ANALYSIS');
    expect(report).toContain(`Schema: ${TEXT_REPORT_SCHEMA}`);
    expect(report).toContain('[Identity]');
    expect(report).toContain('[Metrics]');
    expect(report).toContain('[Top words]');
    expect(report).toContain('[Style signals]');
    expect(report).toContain('[Hidden Unicode summary]');
    expect(report).toContain('[Hidden Unicode findings]');
    expect(report).toContain('U+200B');
    expect(report).toContain('[N-grams]');
    expect(report).toContain('[Word pairs]');
    expect(report).toContain('[NLP]');
    expect(report).toContain('[Part-of-speech distribution]');
    expect(report).toContain('PERSON: Alice');
    expect(report).toContain('[Sentence sentiment]');
    expect(report).toContain('[C2PA]');
    expect(report).toContain('status: not-run');
    expect(report).toContain('[Limitations]');
  });

  it('reports every supplied item and the combined summary', () => {
    const report = buildCompleteTextReport([
      makeItem(),
      makeItem({ id: 2, fileName: 'second.txt', content: 'A short second document.' }),
    ]);

    expect(report).toContain('ITEM 1 OF 2: notes.txt');
    expect(report).toContain('ITEM 2 OF 2: second.txt');
    expect(report).toContain('items: 2');
  });

  it('does not claim that a style score proves authorship', () => {
    const report = buildCompleteTextReport([makeItem()]);
    expect(report).toContain('Heuristic only. It is not a watermark detector or an authorship test.');
    expect(report).toContain('does not certify that a watermark was absent or removed');
  });
});

describe('buildCompleteTextReportCSV', () => {
  it('uses a tidy schema with one data point per row', () => {
    const csv = buildCompleteTextReportCSV([makeItem()]);
    const firstLine = csv.split('\n')[0];

    expect(firstLine).toBe('"Item ID","File Name","Section","Entry","Field","Value","Detail"');
    expect(csv).toContain('"report","","schema","watermark.text-report/1.0"');
    expect(csv).toContain('"metrics","","word_count"');
    expect(csv).toContain('"top_words","model","count"');
    expect(csv).toContain('"style","signal-1","signal"');
    expect(csv).toContain('"hidden_finding","\\u200B","code_point","U+200B"');
    expect(csv).toContain('"hidden_occurrence","\\u200B","position"');
    expect(csv).toContain('"ngram_entry","model was trained","trigram"');
    expect(csv).toContain('"nlp_pos","NOUN","count"');
    expect(csv).toContain('"nlp_entity","entity-1","type","PERSON"');
    expect(csv).toContain('"nlp_sentence_sentiment","sentence-3","sentiment"');
    expect(csv).toContain('"c2pa","","status","not-run"');
  });

  it('keeps multiple files distinguishable by id and name', () => {
    const csv = buildCompleteTextReportCSV([
      makeItem(),
      makeItem({ id: 7, fileName: 'other.md', format: 'md' }),
    ]);

    expect(csv).toContain('"notes.txt"');
    expect(csv).toContain('"other.md"');
    expect(csv).toContain('"7","other.md"');
  });
});
