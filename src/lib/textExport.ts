/**
 * Full, inspectable export of text analysis.
 *
 * JSON is the canonical format: it preserves the whole NLP object, every n-gram
 * list, the complete hidden-Unicode scan, C2PA result, and the cleanup-pipeline
 * context. CSV helpers are flattened views for spreadsheets.
 */
import { getAuditEntries } from './audit';
import { getWinkStatus } from './winkNlp';
import { analyzeText, type TextAnalysis, type TextItem } from './textAnalysis';
import {
  HIDDEN_CATEGORY_DEFS,
  scanHiddenCharacters,
  type HiddenCategoryId,
  type HiddenScanResult,
} from './textForensics';
import { analyzeWriting, suggestSynonyms, type WritingAnalysis } from './writingAnalysis';
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
    const writing = analyzeWriting(item.content, {
      pov: item.writingPov,
      ignoreDialogue: item.writingIgnoreDialogue,
    });

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
      writing,
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
    'POV Detected',
    'POV Anomalies',
    'Clichés',
    'Similes',
    'Metaphor Candidates',
    'Adverbs /1k',
    'Dialogue %',
    'Flesch-Kincaid Grade',
    'Word Echoes',
    'Unique Content Words',
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
    const writing = analyzeWriting(item.content, {
      pov: item.writingPov,
      ignoreDialogue: item.writingIgnoreDialogue,
    });

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
      writing.pov.detected,
      writing.pov.anomalies.length,
      writing.cliches[0]?.count ?? 0,
      writing.similes.count,
      writing.metaphors.count,
      writing.adverbs.per1000.toFixed(1),
      (writing.dialogue.dialogueRatio * 100).toFixed(1),
      writing.readability.fleschKincaidGrade.toFixed(1),
      writing.echoes.reduce((sum, echo) => sum + echo.count, 0),
      writing.uniqueContentWords,
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

export const TEXT_REPORT_SCHEMA = 'watermark.text-report/1.0';

function reportNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function reportItemName(item: TextItem): string {
  return item.fileName ?? (item.source === 'paste' ? 'Pasted text' : 'Untitled');
}

function reportAnalysis(item: TextItem): TextAnalysis {
  return item.analysis ?? analyzeText(item.content);
}

function reportPreview(item: TextItem): string {
  const preview = item.content.slice(0, 2000)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return JSON.stringify(preview);
}

function hiddenLabel(category: HiddenCategoryId): string {
  return HIDDEN_CATEGORY_DEFS.find((definition) => definition.id === category)?.label ?? category;
}

function reportSummaryCounts(items: TextItem[]) {
  const analyzed = items.map((item) => {
    const analysis = reportAnalysis(item);
    const hidden = scanHiddenCharacters(item.content);
    const writing = analyzeWriting(item.content, {
      pov: item.writingPov,
      ignoreDialogue: item.writingIgnoreDialogue,
    });
    return { item, analysis, hidden, writing };
  });

  return {
    analyzed,
    words: analyzed.reduce((sum, entry) => sum + entry.analysis.wordCount, 0),
    characters: analyzed.reduce((sum, entry) => sum + entry.analysis.charCount, 0),
    hiddenSignals: analyzed.reduce((sum, entry) => sum + entry.hidden.totalSignals, 0),
    withHidden: analyzed.filter((entry) => entry.hidden.totalSignals > 0).length,
    withC2pa: analyzed.filter((entry) => entry.item.c2paResult?.status === 'ready').length,
    withPovAnomalies: analyzed.filter((entry) => entry.writing.pov.anomalies.length > 0).length,
    cliches: analyzed.reduce((sum, entry) => sum + (entry.writing.cliches[0]?.count ?? 0), 0),
  };
}

function pushSection(lines: string[], title: string): void {
  lines.push('');
  lines.push(`[${title}]`);
}

function pushField(lines: string[], key: string, value: string | number | boolean): void {
  lines.push(`${key}: ${String(value)}`);
}

/**
 * Human-readable flat text report containing the complete analysis for the
 * supplied items. This is intentionally verbose: every metric, signal, n-gram,
 * Unicode finding, NLP result and C2PA summary is included.
 */
export function buildCompleteTextReport(items: TextItem[]): string {
  const lines: string[] = [];
  const summary = reportSummaryCounts(items);

  lines.push('WATERMARK - COMPLETE TEXT ANALYSIS');
  lines.push(`Schema: ${TEXT_REPORT_SCHEMA}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('Generated locally in the browser. No text or file was uploaded.');
  lines.push('');

  pushSection(lines, 'Report summary');
  pushField(lines, 'items', items.length);
  pushField(lines, 'total_words', summary.words);
  pushField(lines, 'total_characters', summary.characters);
  pushField(lines, 'items_with_hidden_signals', summary.withHidden);
  pushField(lines, 'total_hidden_signals', summary.hiddenSignals);
  pushField(lines, 'items_with_c2pa', summary.withC2pa);
  pushField(lines, 'items_with_pov_anomalies', summary.withPovAnomalies);
  pushField(lines, 'total_cliches', summary.cliches);
  pushField(lines, 'style_score_note', 'Heuristic only. It is not a watermark detector or an authorship test.');

  summary.analyzed.forEach(({ item, analysis, hidden, writing }, index) => {
    lines.push('');
    lines.push('='.repeat(78));
    lines.push(`ITEM ${index + 1} OF ${items.length}: ${reportItemName(item)}`);
    lines.push('='.repeat(78));

    pushSection(lines, 'Identity');
    pushField(lines, 'item_id', item.id);
    pushField(lines, 'source', item.source);
    pushField(lines, 'file_name', reportItemName(item));
    pushField(lines, 'format', item.format ?? 'text');
    pushField(lines, 'status', item.status);
    pushField(lines, 'sha256', item.sha256 || '(not available)');

    pushSection(lines, 'Content');
    pushField(lines, 'characters', item.content.length);
    pushField(lines, 'lines', hidden.lineCount);
    pushField(lines, 'preview', reportPreview(item));
    pushField(
      lines,
      'preview_note',
      item.content.length > 2000
        ? 'Only the first 2,000 characters are shown. The source file was not modified.'
        : 'The complete source is shorter than 2,000 characters.',
    );

    pushSection(lines, 'Metrics');
    pushField(lines, 'char_count', analysis.charCount);
    pushField(lines, 'word_count', analysis.wordCount);
    pushField(lines, 'sentence_count', analysis.sentenceCount);
    pushField(lines, 'paragraph_count', analysis.paragraphCount);
    pushField(lines, 'line_count', analysis.lineCount);
    pushField(lines, 'avg_word_length', reportNumber(analysis.avgWordLength));
    pushField(lines, 'avg_sentence_length', reportNumber(analysis.avgSentenceLength));
    pushField(lines, 'vocabulary_richness', reportNumber(analysis.vocabularyRichness, 4));
    pushField(lines, 'repetition_score', reportNumber(analysis.repetitionScore));
    pushField(lines, 'sentence_uniformity', analysis.sentenceUniformity);
    pushField(lines, 'burstiness', analysis.burstiness);
    pushField(lines, 'style_score', analysis.aiConfidence);
    pushField(lines, 'style_label', styleLabel(analysis.aiConfidence));
    pushField(lines, 'hidden_signal_count', analysis.hiddenSignalCount);
    pushField(lines, 'unicode_normalization', analysis.unicodeNormalization);

    pushSection(lines, 'Top words');
    if (analysis.topWords.length === 0) {
      lines.push('(none)');
    } else {
      for (const [word, count] of analysis.topWords) {
        lines.push(`${word}: ${count}`);
      }
    }

    pushSection(lines, 'Style signals');
    if (analysis.aiSignals.length === 0) {
      lines.push('(none)');
    } else {
      for (const signal of analysis.aiSignals) {
        lines.push(`- ${signal}`);
      }
    }

    pushSection(lines, 'Hidden Unicode summary');
    pushField(lines, 'total_signals', hidden.totalSignals);
    pushField(lines, 'unique_code_points', hidden.uniqueCodePoints);
    pushField(lines, 'non_ascii_characters', hidden.nonAsciiCharacters);
    pushField(lines, 'line_count', hidden.lineCount);
    pushField(lines, 'character_count', hidden.characterCount);
    pushField(lines, 'normalization_form', hidden.normalization.form);
    pushField(lines, 'is_nfc', hidden.normalization.isNFC);
    pushField(lines, 'is_nfd', hidden.normalization.isNFD);
    pushField(lines, 'is_nfkc', hidden.normalization.isNFKC);
    pushField(lines, 'is_nfkd', hidden.normalization.isNFKD);
    pushField(lines, 'combining_marks', hidden.normalization.combiningMarks);
    for (const definition of HIDDEN_CATEGORY_DEFS) {
      pushField(
        lines,
        `category.${definition.id}`,
        `${hidden.byCategory[definition.id]} occurrence(s), ${hidden.uniqueByCategory[definition.id]} unique`,
      );
    }

    pushSection(lines, 'Hidden Unicode findings');
    if (hidden.findings.length === 0) {
      lines.push('(none)');
    } else {
      for (const finding of hidden.findings) {
        lines.push(
          `${finding.escaped} U+${finding.codePoint.toString(16).toUpperCase().padStart(4, '0')} ` +
          `${finding.name} [${hiddenLabel(finding.category)}] count=${finding.count}`,
        );
        for (const occurrence of finding.occurrences) {
          lines.push(
            `  line ${occurrence.line}, column ${occurrence.column}, index ${occurrence.index}: ` +
            `"${occurrence.context.replace(/"/g, '\\"')}"`,
          );
        }
        if (finding.occurrencesTruncated) {
          lines.push('  (occurrences truncated at the scanner limit)');
        }
      }
    }

    pushSection(lines, 'N-grams');
    pushField(lines, 'token_count', analysis.ngrams.tokenCount);
    pushField(lines, 'sentence_count', analysis.ngrams.sentenceCount);
    pushField(lines, 'truncated', analysis.ngrams.truncated);
    for (const level of analysis.ngrams.levels) {
      pushField(
        lines,
        `level.${level.n}.${level.label.replace(/\s+/g, '_')}`,
        `total=${level.total}, unique=${level.unique}, repeated=${level.repeated}, ` +
        `repeated_occurrences=${level.repeatedOccurrences}, repetition_rate=${reportNumber(level.repetitionRate)}`,
      );
    }

    pushNgramList(lines, 'Word pairs', analysis.ngrams.wordPairs);
    pushNgramList(lines, 'Trigrams', analysis.ngrams.trigrams);
    pushNgramList(lines, '4-grams', analysis.ngrams.fourGrams);
    pushNgramList(lines, '5-grams', analysis.ngrams.fiveGrams);
    pushNgramList(lines, 'Repeated phrases', analysis.ngrams.topPhrases);
    pushSection(lines, 'Longest repeated phrase');
    if (analysis.ngrams.longestRepeatedPhrase) {
      lines.push(
        `"${analysis.ngrams.longestRepeatedPhrase.phrase}": ` +
        `${analysis.ngrams.longestRepeatedPhrase.count} occurrence(s), ` +
        `${analysis.ngrams.longestRepeatedPhrase.words.length} words`,
      );
    } else {
      lines.push('(none)');
    }

    pushSection(lines, 'NLP');
    pushField(lines, 'available', Object.keys(analysis.posDistribution).length > 0);
    pushField(lines, 'engine', 'wink-nlp (wink-eng-lite-web-model)');
    pushField(lines, 'status', JSON.stringify(getWinkStatus()));
    pushField(lines, 'sentiment', reportNumber(analysis.nlpSentiment, 4));
    pushField(lines, 'sentence_count', analysis.nlpSentenceCount);
    pushField(lines, 'token_count', analysis.nlpTokenCount);
    pushField(lines, 'adjective_density', reportNumber(analysis.adjectiveDensity));
    pushField(lines, 'noun_density', reportNumber(analysis.nounDensity));
    pushField(lines, 'passive_estimate', reportNumber(analysis.passiveEstimate));
    pushField(lines, 'pronoun_ratio', reportNumber(analysis.pronounRatio));
    pushField(lines, 'entity_density', reportNumber(analysis.entityDensity));

    pushSection(lines, 'Part-of-speech distribution');
    const posEntries = Object.entries(analysis.posDistribution).sort(([, a], [, b]) => b - a);
    if (posEntries.length === 0) {
      lines.push('(none)');
    } else {
      for (const [pos, count] of posEntries) {
        lines.push(`${pos}: ${count}`);
      }
    }

    pushSection(lines, 'Named entities');
    if (analysis.entities.length === 0) {
      lines.push('(none)');
    } else {
      analysis.entities.forEach((entity, entityIndex) => {
        lines.push(`${entityIndex + 1}. ${entity.type}: ${entity.text}`);
      });
    }

    pushSection(lines, 'Sentence sentiment');
    if (analysis.sentenceSentiments.length === 0) {
      lines.push('(none)');
    } else {
      analysis.sentenceSentiments.forEach((sentiment, sentenceIndex) => {
        lines.push(`${sentenceIndex + 1}: ${reportNumber(sentiment, 4)}`);
      });
    }

    pushSection(lines, 'Writing: POV');
    pushField(lines, 'choice', writing.pov.choice);
    pushField(lines, 'detected', writing.pov.detected);
    pushField(lines, 'dialogue_excluded', writing.pov.dialogueExcluded);
    pushField(lines, 'first_person_pronouns', writing.pov.counts.first);
    pushField(lines, 'second_person_pronouns', writing.pov.counts.second);
    pushField(lines, 'third_person_pronouns', writing.pov.counts.third);
    pushField(lines, 'anomaly_count', writing.pov.anomalies.length);
    if (writing.pov.anomalies.length === 0) {
      lines.push('(no POV anomalies)');
    } else {
      for (const anomaly of writing.pov.anomalies) {
        lines.push(
          `sentence ${anomaly.sentenceIndex}: expected ${anomaly.expected}, ` +
          `found ${anomaly.found.join('/')}: ${anomaly.text}`,
        );
      }
    }

    pushSection(lines, 'Writing: readability');
    pushField(lines, 'flesch_reading_ease', reportNumber(writing.readability.fleschReadingEase, 1));
    pushField(lines, 'flesch_kincaid_grade', reportNumber(writing.readability.fleschKincaidGrade, 1));
    pushField(lines, 'gunning_fog', reportNumber(writing.readability.gunningFog, 1));
    pushField(lines, 'sentence_average_words', reportNumber(writing.rhythm.average, 1));
    pushField(lines, 'sentence_longest_words', writing.rhythm.longest);
    pushField(lines, 'sentences_short', writing.rhythm.short);
    pushField(lines, 'sentences_medium', writing.rhythm.medium);
    pushField(lines, 'sentences_long', writing.rhythm.long);
    pushField(lines, 'sentences_very_long', writing.rhythm.veryLong);

    pushSection(lines, 'Writing: word frequency');
    if (writing.frequencies.length === 0) {
      lines.push('(none)');
    } else {
      for (const entry of writing.frequencies) {
        lines.push(`${entry.word}: ${entry.count} (${reportNumber(entry.per1000, 1)}/1k)`);
      }
    }

    pushSection(lines, 'Writing: echoes');
    if (writing.echoes.length === 0) {
      lines.push('(none)');
    } else {
      for (const echo of writing.echoes) {
        lines.push(`${echo.word}: ${echo.count} close repeat(s)`);
        for (const example of echo.examples) {
          lines.push(`  ${example.first} -> ${example.gap} words -> ${example.second}`);
        }
      }
    }

    pushSection(lines, 'Writing: sentence openers');
    if (writing.sentenceOpeners.length === 0) {
      lines.push('(none)');
    } else {
      for (const opener of writing.sentenceOpeners) {
        lines.push(`${opener.word}: ${opener.count}`);
      }
    }
    pushField(lines, 'conjunction_starts', writing.conjunctionStarts);

    pushSection(lines, 'Writing: adverbs');
    pushField(lines, 'total', writing.adverbs.total);
    pushField(lines, 'per_1000_words', reportNumber(writing.adverbs.per1000, 1));
    for (const entry of writing.adverbs.top) {
      lines.push(`${entry.word}: ${entry.count}`);
    }

    pushSection(lines, 'Writing: nominalisations');
    pushField(lines, 'total', writing.nominalizations.total);
    pushField(lines, 'per_1000_words', reportNumber(writing.nominalizations.per1000, 1));
    for (const entry of writing.nominalizations.top) {
      lines.push(`${entry.word}: ${entry.count}`);
    }

    pushSection(lines, 'Writing: dialogue');
    pushField(lines, 'dialogue_segments', writing.dialogue.segments);
    pushField(lines, 'dialogue_characters', writing.dialogue.dialogueCharacters);
    pushField(lines, 'narration_characters', writing.dialogue.narrationCharacters);
    pushField(lines, 'dialogue_ratio', reportNumber(writing.dialogue.dialogueRatio * 100, 1));
    pushField(lines, 'said_count', writing.dialogue.said);
    pushField(lines, 'said_bookisms', writing.dialogue.saidBookisms.count);
    pushField(lines, 'adverb_tags', writing.dialogue.adverbTags.count);

    for (const tic of writing.tics) {
      pushSection(lines, `Writing: ${tic.label}`);
      pushField(lines, 'count', tic.count);
      for (const example of tic.examples) lines.push(`- ${example}`);
    }

    if (writing.cliches.length > 0) {
      pushSection(lines, 'Writing: clichés');
      pushField(lines, 'count', writing.cliches[0].count);
      for (const example of writing.cliches[0].examples) lines.push(`- ${example}`);
    }

    pushSection(lines, 'Writing: simile candidates');
    pushField(lines, 'count', writing.similes.count);
    for (const example of writing.similes.examples) lines.push(`- ${example}`);

    pushSection(lines, 'Writing: metaphor candidates');
    pushField(lines, 'count', writing.metaphors.count);
    for (const example of writing.metaphors.examples) lines.push(`- ${example}`);

    pushSection(lines, 'Writing: offline alternatives');
    if (writing.synonyms.length === 0) {
      lines.push('(none)');
    } else {
      for (const entry of writing.synonyms) {
        lines.push(`${entry.word} (${entry.count}x): ${entry.suggestions.join(', ')}`);
      }
    }

    pushSection(lines, 'Writing notes');
    for (const note of writing.notes) lines.push(`- ${note}`);

    pushSection(lines, 'C2PA');
    const c2pa = item.c2paResult;
    pushField(lines, 'status', c2pa?.status ?? 'not-run');
    pushField(lines, 'validation_state', c2pa?.validationState ?? 'Unknown');
    pushField(lines, 'manifest_count', c2pa?.manifestCount ?? 0);
    if (c2pa?.error) pushField(lines, 'error', c2pa.error);
    if (!c2pa) {
      lines.push('note: C2PA verification was not run for this item.');
    }
    for (const [manifestIndex, manifest] of (c2pa?.manifests ?? []).entries()) {
      pushField(lines, `manifest.${manifestIndex + 1}.label`, manifest.label);
      pushField(lines, `manifest.${manifestIndex + 1}.active`, manifest.isActive);
      if (manifest.title) pushField(lines, `manifest.${manifestIndex + 1}.title`, manifest.title);
      if (manifest.format) pushField(lines, `manifest.${manifestIndex + 1}.format`, manifest.format);
      if (manifest.issuer) pushField(lines, `manifest.${manifestIndex + 1}.issuer`, manifest.issuer);
      if (manifest.claimGenerator) pushField(lines, `manifest.${manifestIndex + 1}.claim_generator`, manifest.claimGenerator);
      if (manifest.signatureAlgorithm) pushField(lines, `manifest.${manifestIndex + 1}.signature_algorithm`, manifest.signatureAlgorithm);
      if (manifest.signedAt) pushField(lines, `manifest.${manifestIndex + 1}.signed_at`, manifest.signedAt);
      if (manifest.claimVersion !== undefined) pushField(lines, `manifest.${manifestIndex + 1}.claim_version`, manifest.claimVersion);
      if (manifest.ingredients.length > 0) pushField(lines, `manifest.${manifestIndex + 1}.ingredients`, manifest.ingredients.join(' | '));
      if (manifest.assertions.length > 0) pushField(lines, `manifest.${manifestIndex + 1}.assertions`, manifest.assertions.join(' | '));
      for (const code of manifest.validationCodes) {
        pushField(
          lines,
          `manifest.${manifestIndex + 1}.validation.${code.code}`,
          `${code.success === false ? 'failure' : code.success === true ? 'success' : 'info'}${code.explanation ? `: ${code.explanation}` : ''}`,
        );
      }
    }
    for (const [warningIndex, warning] of (c2pa?.warnings ?? []).entries()) {
      pushField(lines, `warning.${warningIndex + 1}`, warning);
    }
  });

  pushSection(lines, 'Limitations');
  lines.push('A C2PA signature can be valid while the claims inside it are false or misleading.');
  lines.push('A missing C2PA manifest does not prove that content is human-made.');
  lines.push('Hidden characters are not proof of AI; word processors, chat apps and websites insert them.');
  lines.push('Claude and SynthID text watermarks cannot be detected locally by any public tool.');
  lines.push('The style score is a heuristic, not a watermark detector or an authorship test.');
  lines.push('Removing metadata does not necessarily remove a soft-bound, pixel, audio or video signal.');
  lines.push('This report records what the tool observed. It does not certify that a watermark was absent or removed.');

  return lines.join('\n');
}

function pushNgramList(lines: string[], title: string, entries: { phrase: string; words: string[]; count: number }[]): void {
  pushSection(lines, title);
  if (entries.length === 0) {
    lines.push('(none)');
    return;
  }
  for (const entry of entries) {
    lines.push(`"${entry.phrase}": ${entry.count} occurrence(s), ${entry.words.length} words`);
  }
}

/**
 * Tidy, one-data-point-per-row CSV. Unlike the summary CSV, this includes every
 * n-gram, Unicode occurrence, POS count, entity and sentence sentiment so the
 * whole analysis survives a spreadsheet round-trip.
 */
export function buildCompleteTextReportCSV(items: TextItem[]): string {
  const headers = ['Item ID', 'File Name', 'Section', 'Entry', 'Field', 'Value', 'Detail'];
  const rows: unknown[][] = [];
  const summary = reportSummaryCounts(items);

  function row(
    itemId: number | '',
    fileName: string,
    section: string,
    entry: string,
    field: string,
    value: string | number | boolean,
    detail = '',
  ): void {
    rows.push([itemId, fileName, section, entry, field, value, detail]);
  }

  row('', 'ALL', 'report', '', 'schema', TEXT_REPORT_SCHEMA, 'Complete text analysis report');
  row('', 'ALL', 'report', '', 'generated_at', new Date().toISOString(), 'ISO 8601');
  row('', 'ALL', 'report', '', 'item_count', items.length, '');
  row('', 'ALL', 'report', '', 'total_words', summary.words, '');
  row('', 'ALL', 'report', '', 'total_characters', summary.characters, '');
  row('', 'ALL', 'report', '', 'items_with_hidden_signals', summary.withHidden, '');
  row('', 'ALL', 'report', '', 'total_hidden_signals', summary.hiddenSignals, '');
  row('', 'ALL', 'report', '', 'items_with_c2pa', summary.withC2pa, '');

  summary.analyzed.forEach(({ item, analysis, hidden, writing }) => {
    const name = reportItemName(item);
    const id = item.id;

    row(id, name, 'identity', '', 'source', item.source, '');
    row(id, name, 'identity', '', 'format', item.format ?? 'text', '');
    row(id, name, 'identity', '', 'status', item.status, '');
    row(id, name, 'identity', '', 'sha256', item.sha256 || '(not available)', '');
    row(id, name, 'content', '', 'characters', item.content.length, '');
    row(id, name, 'content', '', 'lines', hidden.lineCount, '');
    row(id, name, 'content', '', 'preview', reportPreview(item), item.content.length > 2000 ? 'First 2,000 characters only' : 'Complete source');
    row(id, name, 'metrics', '', 'char_count', analysis.charCount, '');
    row(id, name, 'metrics', '', 'word_count', analysis.wordCount, '');
    row(id, name, 'metrics', '', 'sentence_count', analysis.sentenceCount, '');
    row(id, name, 'metrics', '', 'paragraph_count', analysis.paragraphCount, '');
    row(id, name, 'metrics', '', 'line_count', analysis.lineCount, '');
    row(id, name, 'metrics', '', 'avg_word_length', reportNumber(analysis.avgWordLength), '');
    row(id, name, 'metrics', '', 'avg_sentence_length', reportNumber(analysis.avgSentenceLength), '');
    row(id, name, 'metrics', '', 'vocabulary_richness', reportNumber(analysis.vocabularyRichness, 4), '');
    row(id, name, 'metrics', '', 'repetition_score', reportNumber(analysis.repetitionScore), '');
    row(id, name, 'metrics', '', 'sentence_uniformity', analysis.sentenceUniformity, '');
    row(id, name, 'metrics', '', 'burstiness', analysis.burstiness, '');
    row(id, name, 'metrics', '', 'style_score', analysis.aiConfidence, 'Heuristic only');
    row(id, name, 'metrics', '', 'style_label', styleLabel(analysis.aiConfidence), 'Heuristic only');
    row(id, name, 'metrics', '', 'hidden_signal_count', analysis.hiddenSignalCount, '');
    row(id, name, 'metrics', '', 'unicode_normalization', analysis.unicodeNormalization, '');

    for (const [word, count] of analysis.topWords) {
      row(id, name, 'top_words', word, 'count', count, '');
    }
    for (const [signalIndex, signal] of analysis.aiSignals.entries()) {
      row(id, name, 'style', `signal-${signalIndex + 1}`, 'signal', signal, 'Heuristic signal');
    }

    row(id, name, 'hidden_unicode', '', 'total_signals', hidden.totalSignals, '');
    row(id, name, 'hidden_unicode', '', 'unique_code_points', hidden.uniqueCodePoints, '');
    row(id, name, 'hidden_unicode', '', 'non_ascii_characters', hidden.nonAsciiCharacters, '');
    row(id, name, 'hidden_unicode', '', 'normalization_form', hidden.normalization.form, '');
    row(id, name, 'hidden_unicode', '', 'is_nfc', hidden.normalization.isNFC, '');
    row(id, name, 'hidden_unicode', '', 'is_nfd', hidden.normalization.isNFD, '');
    row(id, name, 'hidden_unicode', '', 'is_nfkc', hidden.normalization.isNFKC, '');
    row(id, name, 'hidden_unicode', '', 'is_nfkd', hidden.normalization.isNFKD, '');
    row(id, name, 'hidden_unicode', '', 'combining_marks', hidden.normalization.combiningMarks, '');

    for (const definition of HIDDEN_CATEGORY_DEFS) {
      row(id, name, 'hidden_category', definition.id, 'occurrences', hidden.byCategory[definition.id], definition.label);
      row(id, name, 'hidden_category', definition.id, 'unique', hidden.uniqueByCategory[definition.id], definition.label);
    }

    for (const finding of hidden.findings) {
      const escaped = finding.escaped;
      row(id, name, 'hidden_finding', escaped, 'code_point', `U+${finding.codePoint.toString(16).toUpperCase().padStart(4, '0')}`, finding.name);
      row(id, name, 'hidden_finding', escaped, 'name', finding.name, '');
      row(id, name, 'hidden_finding', escaped, 'category', finding.category, hiddenLabel(finding.category));
      row(id, name, 'hidden_finding', escaped, 'count', finding.count, '');
      for (const occurrence of finding.occurrences) {
        row(
          id,
          name,
          'hidden_occurrence',
          escaped,
          'position',
          `${occurrence.line}:${occurrence.column}`,
          `index=${occurrence.index}; context=${occurrence.context}`,
        );
      }
      if (finding.occurrencesTruncated) {
        row(id, name, 'hidden_occurrence', escaped, 'truncated', true, 'Occurrences truncated at the scanner limit');
      }
    }

    row(id, name, 'ngram', '', 'token_count', analysis.ngrams.tokenCount, '');
    row(id, name, 'ngram', '', 'sentence_count', analysis.ngrams.sentenceCount, '');
    row(id, name, 'ngram', '', 'truncated', analysis.ngrams.truncated, '');
    for (const level of analysis.ngrams.levels) {
      const entry = `${level.n} ${level.label}`;
      row(id, name, 'ngram_level', entry, 'total', level.total, '');
      row(id, name, 'ngram_level', entry, 'unique', level.unique, '');
      row(id, name, 'ngram_level', entry, 'repeated', level.repeated, '');
      row(id, name, 'ngram_level', entry, 'repeated_occurrences', level.repeatedOccurrences, '');
      row(id, name, 'ngram_level', entry, 'repetition_rate', reportNumber(level.repetitionRate), '');
    }

    addNgramCsvRows(rows, id, name, 'word_pair', analysis.ngrams.wordPairs);
    addNgramCsvRows(rows, id, name, 'trigram', analysis.ngrams.trigrams);
    addNgramCsvRows(rows, id, name, 'four_gram', analysis.ngrams.fourGrams);
    addNgramCsvRows(rows, id, name, 'five_gram', analysis.ngrams.fiveGrams);
    addNgramCsvRows(rows, id, name, 'repeated_phrase', analysis.ngrams.topPhrases);
    if (analysis.ngrams.longestRepeatedPhrase) {
      row(
        id,
        name,
        'ngram_longest',
        analysis.ngrams.longestRepeatedPhrase.phrase,
        'count',
        analysis.ngrams.longestRepeatedPhrase.count,
        `${analysis.ngrams.longestRepeatedPhrase.words.length} words`,
      );
    }

    row(id, name, 'nlp', '', 'available', Object.keys(analysis.posDistribution).length > 0, '');
    row(id, name, 'nlp', '', 'engine', 'wink-nlp (wink-eng-lite-web-model)', '');
    row(id, name, 'nlp', '', 'status', JSON.stringify(getWinkStatus()), '');
    row(id, name, 'nlp', '', 'sentiment', reportNumber(analysis.nlpSentiment, 4), '');
    row(id, name, 'nlp', '', 'sentence_count', analysis.nlpSentenceCount, '');
    row(id, name, 'nlp', '', 'token_count', analysis.nlpTokenCount, '');
    row(id, name, 'nlp', '', 'adjective_density', reportNumber(analysis.adjectiveDensity), 'ADJ / tokens');
    row(id, name, 'nlp', '', 'noun_density', reportNumber(analysis.nounDensity), 'NOUN + PROPN / tokens');
    row(id, name, 'nlp', '', 'passive_estimate', reportNumber(analysis.passiveEstimate), 'Heuristic');
    row(id, name, 'nlp', '', 'pronoun_ratio', reportNumber(analysis.pronounRatio), 'PRON / tokens');
    row(id, name, 'nlp', '', 'entity_density', reportNumber(analysis.entityDensity), 'Entities per sentence');

    for (const [pos, count] of Object.entries(analysis.posDistribution).sort(([, a], [, b]) => b - a)) {
      row(id, name, 'nlp_pos', pos, 'count', count, 'Part-of-speech token count');
    }
    analysis.entities.forEach((entity, entityIndex) => {
      row(id, name, 'nlp_entity', `entity-${entityIndex + 1}`, 'type', entity.type, entity.text);
      row(id, name, 'nlp_entity', `entity-${entityIndex + 1}`, 'text', entity.text, entity.type);
    });
    analysis.sentenceSentiments.forEach((sentiment, sentenceIndex) => {
      row(id, name, 'nlp_sentence_sentiment', `sentence-${sentenceIndex + 1}`, 'sentiment', reportNumber(sentiment, 4), '');
    });

    row(id, name, 'writing_pov', '', 'choice', writing.pov.choice, '');
    row(id, name, 'writing_pov', '', 'detected', writing.pov.detected, '');
    row(id, name, 'writing_pov', '', 'dialogue_excluded', writing.pov.dialogueExcluded, '');
    row(id, name, 'writing_pov', '', 'first_person_pronouns', writing.pov.counts.first, '');
    row(id, name, 'writing_pov', '', 'second_person_pronouns', writing.pov.counts.second, '');
    row(id, name, 'writing_pov', '', 'third_person_pronouns', writing.pov.counts.third, '');
    row(id, name, 'writing_pov', '', 'anomaly_count', writing.pov.anomalies.length, '');
    for (const anomaly of writing.pov.anomalies) {
      row(id, name, 'writing_pov_anomaly', `sentence-${anomaly.sentenceIndex}`, 'expected', anomaly.expected, '');
      row(id, name, 'writing_pov_anomaly', `sentence-${anomaly.sentenceIndex}`, 'found', anomaly.found.join('/'), '');
      row(id, name, 'writing_pov_anomaly', `sentence-${anomaly.sentenceIndex}`, 'text', anomaly.text, '');
    }

    row(id, name, 'writing_readability', '', 'flesch_reading_ease', reportNumber(writing.readability.fleschReadingEase, 1), '');
    row(id, name, 'writing_readability', '', 'flesch_kincaid_grade', reportNumber(writing.readability.fleschKincaidGrade, 1), '');
    row(id, name, 'writing_readability', '', 'gunning_fog', reportNumber(writing.readability.gunningFog, 1), '');
    row(id, name, 'writing_rhythm', '', 'sentences', writing.rhythm.total, '');
    row(id, name, 'writing_rhythm', '', 'average_words', reportNumber(writing.rhythm.average, 1), '');
    row(id, name, 'writing_rhythm', '', 'longest_words', writing.rhythm.longest, '');
    row(id, name, 'writing_rhythm', 'short', 'count', writing.rhythm.short, 'Sentences up to 10 words');
    row(id, name, 'writing_rhythm', 'medium', 'count', writing.rhythm.medium, 'Sentences 11-20 words');
    row(id, name, 'writing_rhythm', 'long', 'count', writing.rhythm.long, 'Sentences 21-35 words');
    row(id, name, 'writing_rhythm', 'very_long', 'count', writing.rhythm.veryLong, 'Sentences 36+ words');

    for (const entry of writing.frequencies) {
      row(id, name, 'word_frequency', entry.word, 'count', entry.count, '');
      row(id, name, 'word_frequency', entry.word, 'per_1000', reportNumber(entry.per1000, 1), '');
    }

    for (const echo of writing.echoes) {
      row(id, name, 'writing_echo', echo.word, 'close_repeats', echo.count, 'Within 75 words');
      echo.examples.forEach((example, echoIndex) => {
        row(id, name, 'writing_echo_example', echo.word, `example-${echoIndex + 1}`, example.gap, `${example.first} -> ${example.second}`);
      });
    }

    for (const opener of writing.sentenceOpeners) {
      row(id, name, 'writing_sentence_opener', opener.word, 'count', opener.count, '');
    }
    row(id, name, 'writing_sentence_opener', '', 'conjunction_starts', writing.conjunctionStarts, 'And/But/So/Because/Or/Yet/Then');

    row(id, name, 'writing_adverb', '', 'total', writing.adverbs.total, '');
    row(id, name, 'writing_adverb', '', 'per_1000', reportNumber(writing.adverbs.per1000, 1), '');
    for (const entry of writing.adverbs.top) {
      row(id, name, 'writing_adverb', entry.word, 'count', entry.count, '');
    }

    row(id, name, 'writing_nominalization', '', 'total', writing.nominalizations.total, '');
    row(id, name, 'writing_nominalization', '', 'per_1000', reportNumber(writing.nominalizations.per1000, 1), '');
    for (const entry of writing.nominalizations.top) {
      row(id, name, 'writing_nominalization', entry.word, 'count', entry.count, '');
    }

    for (const tic of writing.tics) {
      row(id, name, 'writing_tic', tic.label, 'count', tic.count, '');
      tic.examples.forEach((example, exampleIndex) => {
        row(id, name, 'writing_tic_example', tic.label, `example-${exampleIndex + 1}`, example, '');
      });
    }

    for (const cliche of writing.cliches) {
      row(id, name, 'writing_cliche', cliche.label, 'count', cliche.count, '');
      cliche.examples.forEach((example, exampleIndex) => {
        row(id, name, 'writing_cliche_example', cliche.label, `example-${exampleIndex + 1}`, example, '');
      });
    }

    row(id, name, 'writing_simile', '', 'count', writing.similes.count, 'Grammar candidates only');
    writing.similes.examples.forEach((example, exampleIndex) => {
      row(id, name, 'writing_simile_example', `example-${exampleIndex + 1}`, 'text', example, '');
    });
    row(id, name, 'writing_metaphor', '', 'count', writing.metaphors.count, 'Grammar candidates only');
    writing.metaphors.examples.forEach((example, exampleIndex) => {
      row(id, name, 'writing_metaphor_example', `example-${exampleIndex + 1}`, 'text', example, '');
    });

    row(id, name, 'writing_dialogue', '', 'segments', writing.dialogue.segments, '');
    row(id, name, 'writing_dialogue', '', 'dialogue_characters', writing.dialogue.dialogueCharacters, '');
    row(id, name, 'writing_dialogue', '', 'narration_characters', writing.dialogue.narrationCharacters, '');
    row(id, name, 'writing_dialogue', '', 'dialogue_ratio_percent', reportNumber(writing.dialogue.dialogueRatio * 100, 1), '');
    row(id, name, 'writing_dialogue', '', 'said_count', writing.dialogue.said, '');
    row(id, name, 'writing_dialogue', '', 'said_bookisms', writing.dialogue.saidBookisms.count, '');
    row(id, name, 'writing_dialogue', '', 'adverb_tags', writing.dialogue.adverbTags.count, '');

    for (const entry of writing.synonyms) {
      row(id, name, 'writing_synonym', entry.word, 'suggestions', entry.suggestions.join(', '), `${entry.count} occurrences`);
    }
    writing.notes.forEach((note, noteIndex) => {
      row(id, name, 'writing_note', `note-${noteIndex + 1}`, 'text', note, '');
    });

    const c2pa = item.c2paResult;
    row(id, name, 'c2pa', '', 'status', c2pa?.status ?? 'not-run', '');
    row(id, name, 'c2pa', '', 'validation_state', c2pa?.validationState ?? 'Unknown', '');
    row(id, name, 'c2pa', '', 'manifest_count', c2pa?.manifestCount ?? 0, '');
    if (c2pa?.error) row(id, name, 'c2pa', '', 'error', c2pa.error, '');
    (c2pa?.manifests ?? []).forEach((manifest, manifestIndex) => {
      const entry = `manifest-${manifestIndex + 1}`;
      row(id, name, 'c2pa_manifest', entry, 'label', manifest.label, manifest.isActive ? 'ACTIVE' : '');
      if (manifest.title) row(id, name, 'c2pa_manifest', entry, 'title', manifest.title, '');
      if (manifest.format) row(id, name, 'c2pa_manifest', entry, 'format', manifest.format, '');
      if (manifest.issuer) row(id, name, 'c2pa_manifest', entry, 'issuer', manifest.issuer, '');
      if (manifest.claimGenerator) row(id, name, 'c2pa_manifest', entry, 'claim_generator', manifest.claimGenerator, '');
      if (manifest.signatureAlgorithm) row(id, name, 'c2pa_manifest', entry, 'signature_algorithm', manifest.signatureAlgorithm, '');
      if (manifest.signedAt) row(id, name, 'c2pa_manifest', entry, 'signed_at', manifest.signedAt, '');
      if (manifest.claimVersion !== undefined) row(id, name, 'c2pa_manifest', entry, 'claim_version', manifest.claimVersion, '');
      if (manifest.ingredients.length > 0) row(id, name, 'c2pa_manifest', entry, 'ingredients', manifest.ingredients.join(' | '), '');
      if (manifest.assertions.length > 0) row(id, name, 'c2pa_manifest', entry, 'assertions', manifest.assertions.join(' | '), '');
      for (const code of manifest.validationCodes) {
        row(
          id,
          name,
          'c2pa_validation',
          code.code,
          code.success === false ? 'failure' : code.success === true ? 'success' : 'info',
          code.explanation ?? '',
          manifest.label,
        );
      }
    });
    (c2pa?.warnings ?? []).forEach((warning, warningIndex) => {
      row(id, name, 'c2pa_warning', `warning-${warningIndex + 1}`, 'message', warning, '');
    });
  });

  return csvRows(headers, rows);
}

function addNgramCsvRows(
  rows: unknown[][],
  itemId: number,
  fileName: string,
  kind: string,
  entries: { phrase: string; words: string[]; count: number }[],
): void {
  for (const entry of entries) {
    rows.push([
      itemId,
      fileName,
      'ngram_entry',
      entry.phrase,
      kind,
      entry.count,
      `${entry.words.length} words`,
    ]);
  }
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