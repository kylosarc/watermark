/**
 * N-gram / phrase analysis.
 *
 * Counts word pairs, trigrams, 4-grams and 5-grams within sentence boundaries,
 * then keeps the entries that look like phrases rather than grammatical glue.
 * Everything is deterministic and local.
 */
import { STOP_WORDS } from './stopwords';

export interface NgramEntry {
  /** Space-joined phrase, lower-cased. */
  phrase: string;
  words: string[];
  count: number;
}

export interface NgramLevelStats {
  n: number;
  label: string;
  /** Total n-gram occurrences. */
  total: number;
  /** Distinct n-grams. */
  unique: number;
  /** Distinct n-grams that occur more than once. */
  repeated: number;
  /** Occurrences covered by repeated n-grams. */
  repeatedOccurrences: number;
  /** repeatedOccurrences / total, as a percentage. */
  repetitionRate: number;
}

export interface NgramAnalysis {
  levels: NgramLevelStats[];
  wordPairs: NgramEntry[];
  trigrams: NgramEntry[];
  fourGrams: NgramEntry[];
  fiveGrams: NgramEntry[];
  topPhrases: NgramEntry[];
  longestRepeatedPhrase: NgramEntry | null;
  tokenCount: number;
  sentenceCount: number;
  /** True when very large input was capped. */
  truncated: boolean;
}

const NGRAM_SIZES = [2, 3, 4, 5, 6] as const;
const DISPLAY_SIZES = new Set([2, 3, 4, 5]);
const MAX_TOKENS = 150_000;
const MAX_ANALYZED_TOKENS = 250_000;

const LEVEL_LABELS: Record<number, string> = {
  1: 'Words',
  2: 'Word pairs',
  3: 'Trigrams',
  4: '4-grams',
  5: '5-grams',
  6: '6-grams',
};

export function emptyNgramAnalysis(): NgramAnalysis {
  return {
    levels: [2, 3, 4, 5].map((n) => ({
      n,
      label: LEVEL_LABELS[n],
      total: 0,
      unique: 0,
      repeated: 0,
      repeatedOccurrences: 0,
      repetitionRate: 0,
    })),
    wordPairs: [],
    trigrams: [],
    fourGrams: [],
    fiveGrams: [],
    topPhrases: [],
    longestRepeatedPhrase: null,
    tokenCount: 0,
    sentenceCount: 0,
    truncated: false,
  };
}

function tokenizeSentence(sentence: string): string[] {
  const matches = sentence
    .toLowerCase()
    .replace(/[\u2019\u2018]/g, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?/gu);
  if (!matches) return [];
  return matches
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter((token) => token.length > 0);
}

function isUsefulPhrase(words: string[], n: number): boolean {
  const contentWords = words.filter(
    (word) => word.length > 1 && !STOP_WORDS.has(word),
  );
  if (contentWords.length === 0) return false;

  // A phrase that starts or ends with grammatical glue is usually noise:
  // "in the model", "the model is". Keep bigrams more permissive.
  if (n >= 3 && (STOP_WORDS.has(words[0]) || STOP_WORDS.has(words[words.length - 1]))) {
    return false;
  }

  return contentWords.length / n >= 0.4;
}

function collectEntries(
  map: Map<string, number> | undefined,
  n: number,
  minCount: number,
  limit: number,
): NgramEntry[] {
  if (!map) return [];
  const entries: NgramEntry[] = [];
  for (const [phrase, count] of map) {
    if (count < minCount) continue;
    const words = phrase.split(' ');
    if (words.length !== n || !isUsefulPhrase(words, n)) continue;
    entries.push({ phrase, words, count });
  }
  entries.sort(
    (a, b) =>
      b.count - a.count ||
      b.words.length - a.words.length ||
      a.phrase.localeCompare(b.phrase),
  );
  return entries.slice(0, limit);
}

function levelStats(n: number, map: Map<string, number> | undefined): NgramLevelStats {
  let total = 0;
  let repeated = 0;
  let repeatedOccurrences = 0;
  if (map) {
    for (const count of map.values()) {
      total += count;
      if (count > 1) {
        repeated += 1;
        repeatedOccurrences += count;
      }
    }
  }
  return {
    n,
    label: LEVEL_LABELS[n] ?? `${n}-grams`,
    total,
    unique: map?.size ?? 0,
    repeated,
    repeatedOccurrences,
    repetitionRate: total > 0 ? (repeatedOccurrences / total) * 100 : 0,
  };
}

/**
 * Analyze text into word-pair and longer-phrase counts.
 *
 * Sentence boundaries are respected so a pair never spans two unrelated
 * sentences. Very large inputs are capped so the UI stays responsive; the
 * `truncated` flag records that fact in the export.
 */
export function analyzeNgrams(text: string): NgramAnalysis {
  if (!text || text.trim().length === 0) return emptyNgramAnalysis();

  const counts = new Map<number, Map<string, number>>();
  for (const n of NGRAM_SIZES) counts.set(n, new Map());

  const sentenceChunks = text.split(/(?<=[.!?\u2026])\s+|\n{2,}/u);
  let tokenCount = 0;
  let sentenceCount = 0;
  let truncated = false;

  for (const chunk of sentenceChunks) {
    const tokens = tokenizeSentence(chunk);
    if (tokens.length === 0) continue;
    sentenceCount += 1;
    tokenCount += tokens.length;

    if (tokens.length >= 2) {
      for (const n of NGRAM_SIZES) {
        if (tokens.length < n) continue;
        const map = counts.get(n)!;
        for (let i = 0; i <= tokens.length - n; i++) {
          const phrase = tokens.slice(i, i + n).join(' ');
          map.set(phrase, (map.get(phrase) ?? 0) + 1);
        }
      }
    }

    if (tokenCount >= MAX_TOKENS) {
      truncated = true;
      break;
    }
  }

  if (tokenCount > MAX_ANALYZED_TOKENS) truncated = true;

  const displayLevels = [2, 3, 4, 5]
    .filter((n) => DISPLAY_SIZES.has(n))
    .map((n) => levelStats(n, counts.get(n)));

  const wordPairs = collectEntries(counts.get(2), 2, 1, 20);
  const trigrams = collectEntries(counts.get(3), 3, 1, 15);
  const fourGrams = collectEntries(counts.get(4), 4, 1, 15);
  const fiveGrams = collectEntries(counts.get(5), 5, 1, 15);

  const repeatedLongPhrases: NgramEntry[] = [];
  for (const n of [3, 4, 5]) {
    repeatedLongPhrases.push(...collectEntries(counts.get(n), n, 2, 100));
  }
  repeatedLongPhrases.sort(
    (a, b) =>
      b.count - a.count ||
      b.words.length - a.words.length ||
      a.phrase.localeCompare(b.phrase),
  );

  let longestRepeatedPhrase: NgramEntry | null = null;
  for (const n of [6, 5, 4, 3, 2]) {
    const candidate = collectEntries(counts.get(n), n, 2, 1)[0];
    if (candidate) {
      longestRepeatedPhrase = candidate;
      break;
    }
  }

  return {
    levels: displayLevels,
    wordPairs,
    trigrams,
    fourGrams,
    fiveGrams,
    topPhrases: repeatedLongPhrases.slice(0, 20),
    longestRepeatedPhrase,
    tokenCount,
    sentenceCount,
    truncated,
  };
}