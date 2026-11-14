/**
 * Full, inspectable export of text analysis.
 *
 * JSON is the canonical format: it preserves the whole NLP object, every n-gram
 * list, the complete hidden-Unicode scan, C2PA result, and the cleanup-pipeline
 * context. CSV helpers are flattened views for spreadsheets.
 */
import { getAuditEntries } from './audit';
import { getWinkStatus } from './winkNlp';
import { analyzeText, type TextItem } from './textAnalysis';
import { scanHiddenCharacters } from './textForensics';
import {
  CLEANUP_LAYERS,
  CLEANUP_SOURCES,
  PROVIDERS,
  PROVIDER_STATUS_SOURCE,
  RESIDUAL_RISKS,
  VERIFICATION_LEVELS,
} from './providers';

export const TEXT_EXPORT_SCHEMA = 'watermark.text-analysis/2.0';

export interface TextExportOptions {
  /** Include the first 2,000 characters of each source. Default true. */
  includeSourcePreview?: boolean;
  /** Include the app-wide audit trail as workspace context. Default true. */
  includeAuditTrail?: boolean;
  /** Include the provider status reference data. Default true. */
  includeProviderContext?: boolean;
}

function styleLabel(score: number): string {
  if (score <= 20) return 'Likely human (heuristic)';
  if (score <= 40) return 'Possibly human (heuristic)';
  if (score <= 60) return 'Uncertain (heuristic)';
  if (score <= 80) return 'Possibly AI (heuristic)';
  return 'Likely AI (heuristic)';
}

/** Build the complete JSON export object. */
export function buildTextAnalysisExport(
  items: TextItem[],
  options: TextExportOptions = {},
): Record<string, unknown> {
  const includeSourcePreview = options.includeSourcePreview !== false;
  const includeAuditTrail = options.includeAuditTrail !== false;
  const includeProviderContext = options.includeProviderContext !== false;

  const analyzed = items.map((item) => {
    const analysis = item.analysis ?? analyzeText(item.content);
    const hidden = scanHiddenCharacters(item.content);
    const ngrams = analysis.ngrams;
    const preview = item.content.slice(0, 2000);

    return {
      id: item.id,
      source: item.source,
      fileName: item.fileName,
      format: item.format ?? 'text',
      status: item.status,
      sha256: item.sha256,
      content: {
        length: item.content.length,
        lineCount: hidden.lineCount,
        preview: includeSourcePreview ? preview : undefined,
        previewTruncated: includeSourcePreview ? item.content.length > preview.length : undefined,
        previewNote: includeSourcePreview
          ? 'Only the first 2,000 characters are included. The source file was not uploaded or modified.'
          : 'Source preview omitted by export option.',
      },
      analysis,
      nlp: {
        available: Object.keys(analysis.posDistribution).length > 0,
        engine: 'wink-nlp (wink-eng-lite-web-model)',
        status: getWinkStatus(),
        sentiment: analysis.nlpSentiment,
        sentenceSentiments: analysis.sentenceSentiments,
        sentenceCount: analysis.nlpSentenceCount,
        tokenCount: analysis.nlpTokenCount,
        posDistribution: analysis.posDistribution,
        entities: analysis.entities,
        adjectiveDensity: analysis.adjectiveDensity,
        nounDensity: analysis.nounDensity,
        passiveEstimate: analysis.passiveEstimate,
        pronounRatio: analysis.pronounRatio,
        entityDensity: analysis.entityDensity,
      },
      ngrams: {
        levels: ngrams.levels,
        wordPairs: ngrams.wordPairs,
        trigrams: ngrams.trigrams,
        fourGrams: ngrams.fourGrams,
        fiveGrams: ngrams.fiveGrams,
        topPhrases: ngrams.topPhrases,
        longestRepeatedPhrase: ngrams.longestRepeatedPhrase,
        tokenCount: ngrams.tokenCount,
        sentenceCount: ngrams.sentenceCount,
        truncated: ngrams.truncated,
      },
      hiddenCharacters: hidden,
      c2pa: item.c2paResult,
      verification: {
        c2pa: item.c2paResult
          ? {
              status: item.c2paResult.status,
              validationState: item.c2paResult.validationState,
              manifestCount: item.c2paResult.manifestCount,
            }
          : { status: 'not-run', validationState: 'Unknown', manifestCount: 0 },
        hiddenUnicode:
          hidden.totalSignals > 0
            ? {
                level: 'detected',
                label: 'Detected signal',
                note: 'Hidden code points are a fact about the text, not proof of AI authorship.',
              }
            : {
                level: 'not-detected',
                label: 'Not detected',
                note: 'The specific code-point checks found nothing. This is not proof that no watermark exists.',
              },
        providerTextWatermark: {
          level: 'unavailable',
          label: 'Verification unavailable',
          note: 'Claude and SynthID text watermarks have no public local detector.',
        },
        styleHeuristic: {
          level: 'inconclusive',
          label: 'Inconclusive',
          score: analysis.aiConfidence,
          styleLabel: styleLabel(analysis.aiConfidence),
          signals: analysis.aiSignals,
          note: 'A style heuristic, not a watermark detector. Low scores do not prove human authorship.',
        },
      },
      cleanupPipeline: {
        layerA: {
          layer: 'A',
          name: 'Unicode cleanup',
          deterministic: true,
          signalsFound: hidden.totalSignals,
          categories: hidden.byCategory,
          normalization: hidden.normalization,
          note: 'Rescanning the same code-point checks verifies what changed. This does not remove a statistical watermark.',
        },
        layerB: {
          layer: 'B',
          name: 'Statistical rewrite',
          deterministic: false,
          available: true,
          tool: 'Improve Text / Unslop',
          note: 'Best-effort. Anthropic’s Claude detector is private-preview and Google has no public SynthID text detector, so removal cannot be certified locally.',
        },
        layerC: {
          layer: 'C',
          name: 'Container metadata',
          deterministic: true,
          applicable: item.source === 'file',
          c2paPresent: item.c2paResult?.status === 'ready',
          note:
            'This item is extracted text. C2PA, EXIF and XMP belong to the original container; use the Inspector or metadata tools for the file itself.',
        },
      },
    };
  });

  const totalWords = analyzed.reduce((sum, item) => sum + item.analysis.wordCount, 0);
  const totalChars = analyzed.reduce((sum, item) => sum + item.analysis.charCount, 0);
  const hiddenSignalCount = analyzed.reduce(
    (sum, item) => sum + item.hiddenCharacters.totalSignals,
    0,
  );

  return {
    schema: TEXT_EXPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    generator: {
      name: 'Watermark',
      version: '2.4',
      mode: 'text-analysis',
      localOnly: true,
      note: 'Generated in the browser. No text or file was uploaded to produce this report.',
    },
    summary: {
      itemCount: analyzed.length,
      totalCharacters: totalChars,
      totalWords,
      totalSentences: analyzed.reduce((sum, item) => sum + item.analysis.sentenceCount, 0),
      totalNlpTokens: analyzed.reduce((sum, item) => sum + item.analysis.nlpTokenCount, 0),
      averageStyleScore:
        analyzed.length > 0
          ? analyzed.reduce((sum, item) => sum + item.analysis.aiConfidence, 0) / analyzed.length
          : 0,
      itemsWithHiddenSignals: analyzed.filter((item) => item.hiddenCharacters.totalSignals > 0).length,
      hiddenSignalCount,
      itemsWithC2pa: analyzed.filter((item) => item.c2pa?.status === 'ready').length,
      totalWordPairs: analyzed.reduce((sum, item) => sum + (item.ngrams.levels[0]?.total ?? 0), 0),
      uniqueWordPairs: analyzed.reduce((sum, item) => sum + (item.ngrams.levels[0]?.unique ?? 0), 0),
      totalRepeatedPhrases: analyzed.reduce((sum, item) => sum + item.ngrams.topPhrases.length, 0),
      providerTextWatermark: 'Verification unavailable',
    },
    items: analyzed,
    methodology: {
      statement:
        'Watermark separates deterministic checks, cryptographic verification, style heuristics and provider-side claims. It does not produce a single authenticity verdict.',
      verificationLevels: VERIFICATION_LEVELS,
      limitations: [
        'A C2PA signature can be valid while the claims inside it are false or misleading.',
        'A missing C2PA manifest does not prove that content is human-made.',
        'Hidden characters are not proof of AI; word processors, chat apps and websites insert them.',
        'Claude and SynthID text watermarks cannot be detected locally by any public tool.',
        'The style score is a heuristic, not a watermark detector or an authorship test.',
        'Removing metadata does not necessarily remove a soft-bound, pixel, audio or video signal.',
        'This export records what the tool observed. It does not certify that a watermark was absent or removed.',
      ],
    },
    cleanup: {
      model: CLEANUP_LAYERS,
      residualRisks: RESIDUAL_RISKS,
      sources: CLEANUP_SOURCES,
    },
    ...(includeProviderContext
      ? {
          providers: {
            statusSource: PROVIDER_STATUS_SOURCE,
            entries: PROVIDERS,
            note: 'Provider status is cited, not detected. Re-check the linked primary sources before relying on a row.',
          },
        }
      : {}),
    ...(includeAuditTrail
      ? {
          workspace: {
            auditTrail: getAuditEntries(),
            auditTrailNote:
              'Local audit entries are included as workspace context. They record actions in this browser, not facts about the asset.',
          },
        }
      : {}),
    sources: [
      ...CLEANUP_SOURCES,
      {
        label: PROVIDER_STATUS_SOURCE.label,
        url: PROVIDER_STATUS_SOURCE.url,
        note: PROVIDER_STATUS_SOURCE.note,
      },
    ],
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRows(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\n');
}

/** Flattened one-row-per-item summary for spreadsheets. */
export function buildTextSummaryCSV(items: TextItem[]): string {
  const headers = [
    'Item ID',
    'Source',
    'File Name',
    'Format',
    'SHA-256',
    'Characters',
    'Words',
    'Sentences',
    'Paragraphs',
    'Lines',
    'Avg Word Length',
    'Avg Sentence Length',
    'Vocabulary Richness',
    'Repetition Score',
    'Burstiness',
    'Sentence Uniformity',
    'Style Score',
    'Style Signals',
    'Hidden Unicode Signals',
    'Hidden Unicode Categories',
    'Unicode Normalization',
    'NLP Sentiment',
    'NLP Tokens',
    'POS Tags',
    'Named Entities',
    'Adjective Density',
    'Noun Density',
    'Passive Estimate',
    'Pronoun Ratio',
    'Entities Per Sentence',
    'Word Pairs Total',
    'Word Pairs Unique',
    'Word Pairs Repeated',
    'Bigram Repetition %',
    'Trigrams Total',
    'Trigrams Unique',
    'Trigrams Repeated',
    '4-grams Total',
    '5-grams Total',
    'Top Phrase',
    'Longest Repeated Phrase',
    'C2PA Status',
    'C2PA Validation',
  ];

  const rows = items.map((item) => {
    const analysis = item.analysis ?? analyzeText(item.content);
    const hidden = scanHiddenCharacters(item.content);
    const pairLevel = analysis.ngrams.levels.find((level) => level.n === 2);
    const trigramLevel = analysis.ngrams.levels.find((level) => level.n === 3);
    const fourGramLevel = analysis.ngrams.levels.find((level) => level.n === 4);
    const fiveGramLevel = analysis.ngrams.levels.find((level) => level.n === 5);
    const topPhrase = analysis.ngrams.topPhrases[0];
    const longest = analysis.ngrams.longestRepeatedPhrase;

    return [
      item.id,
      item.source,
      item.fileName ?? '',
      item.format ?? 'text',
      item.sha256,
      analysis.charCount,
      analysis.wordCount,
      analysis.sentenceCount,
      analysis.paragraphCount,
      analysis.lineCount,
      analysis.avgWordLength,
      analysis.avgSentenceLength,
      analysis.vocabularyRichness,
      analysis.repetitionScore,
      analysis.burstiness,
      analysis.sentenceUniformity,
      analysis.aiConfidence,
      analysis.aiSignals.join(' | '),
      hidden.totalSignals,
      JSON.stringify(hidden.byCategory),
      hidden.normalization.form,
      analysis.nlpSentiment,
      analysis.nlpTokenCount,
      Object.keys(analysis.posDistribution).length,
      analysis.entities.length,
      analysis.adjectiveDensity,
      analysis.nounDensity,
      analysis.passiveEstimate,
      analysis.pronounRatio,
      analysis.entityDensity,
      pairLevel?.total ?? 0,
      pairLevel?.unique ?? 0,
      pairLevel?.repeated ?? 0,
      pairLevel?.repetitionRate ?? 0,
      trigramLevel?.total ?? 0,
      trigramLevel?.unique ?? 0,
      trigramLevel?.repeated ?? 0,
      fourGramLevel?.total ?? 0,
      fiveGramLevel?.total ?? 0,
      topPhrase?.phrase ?? '',
      longest?.phrase ?? '',
      item.c2paResult?.status ?? 'not-run',
      item.c2paResult?.validationState ?? 'Unknown',
    ];
  });

  return csvRows(headers, rows);
}

/** One row per top word pair / trigram / 4-gram / 5-gram / repeated phrase. */
export function buildPhraseCSV(items: TextItem[]): string {
  const headers = ['Item ID', 'File Name', 'Kind', 'Phrase', 'Words', 'Count'];
  const rows: unknown[][] = [];

  for (const item of items) {
    const analysis = item.analysis ?? analyzeText(item.content);
    const groups: Array<[string, typeof analysis.ngrams.wordPairs]> = [
      ['word-pair', analysis.ngrams.wordPairs],
      ['trigram', analysis.ngrams.trigrams],
      ['4-gram', analysis.ngrams.fourGrams],
      ['5-gram', analysis.ngrams.fiveGrams],
      ['repeated-phrase', analysis.ngrams.topPhrases],
    ];
    for (const [kind, entries] of groups) {
      for (const entry of entries) {
        rows.push([
          item.id,
          item.fileName ?? 'Pasted text',
          kind,
          entry.phrase,
          entry.words.length,
          entry.count,
        ]);
      }
    }
  }

  return csvRows(headers, rows);
}

/** Flat NLP export: summary, sentence sentiment, POS counts and entities. */
export function buildNlpCSV(items: TextItem[]): string {
  const headers = ['Item ID', 'File Name', 'Section', 'Index', 'Key', 'Value', 'Detail'];
  const rows: unknown[][] = [];

  for (const item of items) {
    const analysis = item.analysis ?? analyzeText(item.content);
    const name = item.fileName ?? 'Pasted text';

    rows.push([
      item.id,
      name,
      'summary',
      '',
      'sentiment',
      analysis.nlpSentiment,
      'Overall sentiment from wink-nlp',
    ]);
    rows.push([
      item.id,
      name,
      'summary',
      '',
      'tokens',
      analysis.nlpTokenCount,
      'NLP token count',
    ]);
    rows.push([
      item.id,
      name,
      'summary',
      '',
      'sentences',
      analysis.nlpSentenceCount,
      'NLP sentence count',
    ]);

    analysis.sentenceSentiments.forEach((sentiment, index) => {
      rows.push([
        item.id,
        name,
        'sentence',
        index + 1,
        'sentiment',
        sentiment,
        'Per-sentence sentiment',
      ]);
    });

    Object.entries(analysis.posDistribution)
      .sort(([, a], [, b]) => b - a)
      .forEach(([pos, count]) => {
        rows.push([item.id, name, 'pos', '', pos, count, 'Part-of-speech token count']);
      });

    analysis.entities.forEach((entity, index) => {
      rows.push([
        item.id,
        name,
        'entity',
        index + 1,
        entity.type,
        entity.text,
        'Named entity',
      ]);
    });
  }

  return csvRows(headers, rows);
}