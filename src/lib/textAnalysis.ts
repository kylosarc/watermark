/**
 * Text analysis domain model and heuristics.
 *
 * The style score here is intentionally labelled as a heuristic. It is not a
 * provider watermark detector and it is not proof of authorship. Deterministic
 * checks (Unicode, hashes, C2PA) are kept separate from it.
 */
import type { VerificationResult } from './types';
import { STOP_WORDS } from './stopwords';
import { analyzeNgrams, emptyNgramAnalysis, type NgramAnalysis } from './ngrams';
import {
  scanHiddenCharacters,
  emptyHiddenCategoryCounts,
  type HiddenCategoryId,
} from './textForensics';
import { analyzeWithNlp } from './winkNlp';

export interface TextAnalysis {
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  lineCount: number;
  avgWordLength: number;
  avgSentenceLength: number;
  vocabularyRichness: number; // unique words / total words
  repetitionScore: number; // 0-100, higher = more repetitive
  sentenceUniformity: number; // 0-100, higher = more uniform lengths
  burstiness: number; // 0-100, higher = more varied (human-like)
  topWords: [string, number][];
  aiConfidence: number; // 0-100, style heuristic only
  aiSignals: string[];
  // N-gram / phrase analysis
  ngrams: NgramAnalysis;
  // Deterministic hidden-Unicode summary (full scan available separately)
  hiddenSignalCount: number;
  hiddenCategories: Record<HiddenCategoryId, number>;
  unicodeNormalization: string;
  // wink-nlp fields
  nlpSentiment: number; // -1 to 1
  nlpSentenceCount: number;
  nlpTokenCount: number;
  posDistribution: Record<string, number>;
  entities: { text: string; type: string }[];
  sentenceSentiments: number[];
  adjectiveDensity: number; // ADJ / total tokens
  nounDensity: number; // NOUN + PROPN / total tokens
  passiveEstimate: number; // estimated passive voice ratio
  pronounRatio: number; // PRON / total tokens
  entityDensity: number; // entities per sentence
}

export interface TextItem {
  id: number;
  source: 'file' | 'paste';
  fileName: string | null;
  content: string;
  c2paResult: VerificationResult | null;
  sha256: string;
  analysis: TextAnalysis | null;
  status: 'pending' | 'analyzing' | 'done' | 'error';
  format?: string;
}

export function createEmptyAnalysis(): TextAnalysis {
  return {
    charCount: 0,
    wordCount: 0,
    sentenceCount: 0,
    paragraphCount: 0,
    lineCount: 0,
    avgWordLength: 0,
    avgSentenceLength: 0,
    vocabularyRichness: 0,
    repetitionScore: 0,
    sentenceUniformity: 0,
    burstiness: 0,
    topWords: [],
    aiConfidence: 0,
    aiSignals: [],
    ngrams: emptyNgramAnalysis(),
    hiddenSignalCount: 0,
    hiddenCategories: emptyHiddenCategoryCounts(),
    unicodeNormalization: 'NFC',
    nlpSentiment: 0,
    nlpSentenceCount: 0,
    nlpTokenCount: 0,
    posDistribution: {},
    entities: [],
    sentenceSentiments: [],
    adjectiveDensity: 0,
    nounDensity: 0,
    passiveEstimate: 0,
    pronounRatio: 0,
    entityDensity: 0,
  };
}

export function analyzeText(text: string): TextAnalysis {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const lines = text.split('\n');

  const charCount = text.length;
  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const paragraphCount = paragraphs.length;
  const lineCount = lines.length;

  const avgWordLength =
    wordCount > 0 ? words.reduce((sum, w) => sum + w.length, 0) / wordCount : 0;
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;

  // Vocabulary richness (type-token ratio)
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const vocabularyRichness = wordCount > 0 ? uniqueWords.size / wordCount : 0;

  // Repetition score
  const wordFreq = new Map<string, number>();
  words.forEach((w) => {
    const low = w.toLowerCase();
    wordFreq.set(low, (wordFreq.get(low) ?? 0) + 1);
  });
  const maxFreq = Math.max(...wordFreq.values(), 0);
  const repetitionScore =
    wordCount > 0 ? Math.min(100, (maxFreq / wordCount) * 100 * 10) : 0;

  // Sentence uniformity (coefficient of variation of sentence lengths)
  const sentLengths = sentences.map((s) => s.split(/\s+/).length);
  if (sentLengths.length > 1) {
    const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
    const variance =
      sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / sentLengths.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    // Low CV = uniform (AI-like), High CV = varied (human-like)
  }

  // Burstiness (variance in sentence lengths — humans are bursty)
  const burstiness =
    sentLengths.length > 1
      ? Math.min(
          100,
          (() => {
            const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
            const variance =
              sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) /
              sentLengths.length;
            return Math.sqrt(variance) * 10;
          })(),
        )
      : 50;

  // Top words (excluding common stop words)
  const filteredWords = words
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const topFreq = new Map<string, number>();
  filteredWords.forEach((w) => topFreq.set(w, (topFreq.get(w) ?? 0) + 1));
  const topWords: [string, number][] = Array.from(topFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // AI detection signals — style heuristics, not watermark detection.
  const aiSignals: string[] = [];
  let aiScore = 0;

  // Signal 1: Low vocabulary richness (AI tends to use common words)
  if (vocabularyRichness < 0.4 && wordCount > 50) {
    aiSignals.push('Low vocabulary richness — limited word variety');
    aiScore += 15;
  }

  // Signal 2: High sentence uniformity
  if (sentLengths.length > 2) {
    const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
    const variance =
      sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / sentLengths.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv < 0.3) {
      aiSignals.push('Uniform sentence lengths — low structural variation');
      aiScore += 20;
    }
  }

  // Signal 3: Low burstiness
  if (burstiness < 25 && wordCount > 100) {
    aiSignals.push('Low burstiness — sentences lack natural rhythm');
    aiScore += 20;
  }

  // Signal 4: High repetition
  if (repetitionScore > 5) {
    aiSignals.push('High word repetition — formulaic patterns');
    aiScore += 10;
  }

  // Signal 5: Very long avg sentence (AI can be verbose)
  if (avgSentenceLength > 25) {
    aiSignals.push('Long average sentences — verbose style');
    aiScore += 10;
  }

  // Signal 6: Short avg word length (simple vocabulary)
  if (avgWordLength < 4 && wordCount > 50) {
    aiSignals.push('Short average word length — simple vocabulary');
    aiScore += 5;
  }

  // Signal 7: Very consistent paragraph lengths
  if (paragraphs.length > 2) {
    const paraLengths = paragraphs.map((p) => p.split(/\s+/).length);
    const paraMean = paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length;
    const paraVariance =
      paraLengths.reduce((sum, l) => sum + (l - paraMean) ** 2, 0) /
      paraLengths.length;
    const paraCv = paraMean > 0 ? Math.sqrt(paraVariance) / paraMean : 0;
    if (paraCv < 0.2) {
      aiSignals.push('Uniform paragraph lengths — templated structure');
      aiScore += 10;
    }
  }

  // Signal 8: AI-typical phrases (comprehensive list)
  const aiPhrases = [
    // Classic filler phrases
    'it is important to note', 'it is worth noting', 'in conclusion', 'furthermore', 'moreover',
    'in addition', 'as a result', 'in this essay', 'this article will', 'let us delve',
    'without further ado', 'in today\'s world', 'in the realm of', 'it goes without saying',
    'needless to say', 'it is crucial to understand', 'as we delve', 'buckle up', 'dive deep',
    'game changer', 'holistic approach', 'synergy', 'leverage', 'paradigm shift',
    'cutting edge', 'state of the art', 'at the end of the day',
    // Stands/serves as patterns
    'serves as a testament', 'stands as a reminder', 'plays a crucial role',
    'plays a pivotal role', 'plays a vital role', 'plays a significant role',
    'plays a key role', 'plays a key moment', 'underscores its importance',
    'underscores its significance', 'reflects broader', 'symbolizing its',
    'contributing to the', 'setting the stage for', 'marking a shift',
    'shaping the', 'key turning point', 'evolving landscape', 'focal point',
    'indelible mark', 'deeply rooted',
    // Highlighting/ensuring patterns
    'highlighting the', 'underscoring the', 'emphasizing the',
    'ensuring that', 'reflecting the', 'symbolizing the',
    'contributing to the', 'cultivating', 'fostering', 'encompassing',
    'enhancing', 'valuable insights', 'align with', 'resonate with',
    // Transition words (especially sentence-starting)
    'additionally,', 'furthermore,', 'moreover,', 'consequently,',
    'nevertheless,', 'nonetheless,', 'accordingly,', 'subsequently,',
    // Verbose synonyms
    'boasts', 'bolstered', 'crucial', 'deep dive', 'delve',
    'emphasizing', 'enduring', 'enhance', 'fostering', 'garner',
    'highlight', 'interplay', 'intricate', 'intricacies',
    'landscape', 'meticulous', 'meticulously', 'pivotal', 'robust',
    'showcase', 'tapestry', 'testament', 'underscore', 'valuable', 'vibrant',
    // Structural patterns
    'despite its', 'faces several challenges', 'despite these challenges',
    'challenges and legacy', 'future outlook',
    // Verb patterns
    'serves as', 'stands as', 'marks', 'functions as', 'operates as',
    'represents', 'boasts', 'features', 'maintains', 'offers', 'refers to',
    // Comparison patterns
    'not just', 'but also',
    // Chatbot patterns
    'worth surfacing', 'honest', 'not just', 'shaped', 'shipped',
    'claims', 'silently', 'surfaced', 'worth', 'ships',
    'that\'s a real', 'honestly', 'honesty', 'that\'s not',
    'pretends to', 'renaming it', 'unearned', 'earned', 'real gap',
    'problem underneath', 'carry', 'carries', 'smaller claim',
    'reframe', 'reframing', 'reframed', 'adds nothing new', 'gap',
    'want me to', 'flag', 'flagging', 'flagged', 'nothing I found',
    'genuinely deserves',
    // Helpfulness patterns
    'i hope this helps', 'of course!', 'certainly!',
    'you\'re absolutely right!', 'would you like', 'is there anything else',
    'let me know', 'more detailed breakdown', 'here is a',
    // Wikipedia/encyclopedia style
    'ensured that', 'adheres to', 'refined', 'enhanced', 'enriched',
    'streamlined', 'improved', 'in compliance with', 'complies with',
    'wikipedia guidelines', 'wikipedia standards', 'revised',
    'verifiability', 'neutrality', 'neutral tone', 'encyclopedic tone',
    'clarity', 'flow',
    // Marketing AI speak
    'boasts a vibrant', 'rich', 'profound', 'enhancing', 'showcasing',
    'exemplifies commitment to', 'natural beauty', 'nestled in the heart of',
    'groundbreaking', 'renowned', 'featuring diverse array',
  ];
  const lowerText = text.toLowerCase();
  const foundPhrases = aiPhrases.filter((p) => lowerText.includes(p));
  if (foundPhrases.length > 0) {
    aiSignals.push(
      `AI-typical phrases found: "${foundPhrases.slice(0, 3).join('", "')}"${
        foundPhrases.length > 3 ? ` (+${foundPhrases.length - 3} more)` : ''
      }`,
    );
    aiScore += Math.min(30, foundPhrases.length * 5);
  }

  // Signal 9: Em dash overuse (—)
  const emDashCount = (text.match(/—/g) ?? []).length;
  if (emDashCount > 3) {
    aiSignals.push(`Frequent em dashes (${emDashCount} occurrences) — stylistic overuse`);
    aiScore += Math.min(15, emDashCount * 2);
  }

  // Signal 10: Emoji detection
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
  const emojiCount = (text.match(emojiRegex) ?? []).length;
  if (emojiCount > 0) {
    aiSignals.push(`Emojis detected (${emojiCount} found) — unusual in formal text`);
    aiScore += Math.min(10, emojiCount * 2);
  }

  // Signal 11: Overuse of bolding (markdown ** or __)
  const boldPattern = /\*\*[^*]+\*\*|__[^_]+__/g;
  const boldMatches = text.match(boldPattern) ?? [];
  if (boldMatches.length > 5) {
    aiSignals.push(`Heavy bolding (${boldMatches.length} instances) — excessive formatting`);
    aiScore += Math.min(10, boldMatches.length);
  }

  // Signal 12: Dash separator patterns (----, ----, etc.)
  const dashSeparatorRegex = /^[-=_]{3,}$/gm;
  const dashSeparators = (text.match(dashSeparatorRegex) ?? []).length;
  if (dashSeparators > 0) {
    aiSignals.push(`Dash separators (${dashSeparators} found) — templated formatting`);
    aiScore += dashSeparators * 3;
  }

  const aiConfidence = Math.min(100, aiScore);

  // Deterministic additions
  const ngrams = analyzeNgrams(text);
  const hidden = scanHiddenCharacters(text);

  return {
    charCount,
    wordCount,
    sentenceCount,
    paragraphCount,
    lineCount,
    avgWordLength,
    avgSentenceLength,
    vocabularyRichness,
    repetitionScore,
    sentenceUniformity:
      sentLengths.length > 1
        ? (() => {
            const mean = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
            const variance =
              sentLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) /
              sentLengths.length;
            const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
            return Math.round((1 - Math.min(1, cv)) * 100);
          })()
        : 50,
    burstiness: Math.round(burstiness),
    topWords,
    aiConfidence,
    aiSignals,
    ngrams,
    hiddenSignalCount: hidden.totalSignals,
    hiddenCategories: hidden.byCategory,
    unicodeNormalization: hidden.normalization.form,
    nlpSentiment: 0,
    nlpSentenceCount: sentenceCount,
    nlpTokenCount: wordCount,
    posDistribution: {} as Record<string, number>,
    entities: [] as { text: string; type: string }[],
    sentenceSentiments: [] as number[],
    adjectiveDensity: 0,
    nounDensity: 0,
    passiveEstimate: 0,
    pronounRatio: 0,
    entityDensity: 0,
  };
}

// NLP enrichment — call after analyzeText to fill in wink-nlp fields
export async function enrichWithNlp(
  analysis: TextAnalysis,
  text: string,
): Promise<TextAnalysis> {
  const nlp = await analyzeWithNlp(text);
  if (!nlp) return analysis;

  const totalTokens = nlp.tokenCount || 1;
  const adjCount = nlp.posDistribution['ADJ'] ?? 0;
  const nounCount =
    (nlp.posDistribution['NOUN'] ?? 0) + (nlp.posDistribution['PROPN'] ?? 0);
  const auxCount = nlp.posDistribution['AUX'] ?? 0;
  const verbCount = nlp.posDistribution['VERB'] ?? 0;
  const pronCount = nlp.posDistribution['PRON'] ?? 0;

  return {
    ...analysis,
    nlpSentiment: nlp.sentiment,
    nlpSentenceCount: nlp.sentenceCount,
    nlpTokenCount: nlp.tokenCount,
    posDistribution: nlp.posDistribution,
    entities: nlp.entities,
    sentenceSentiments: nlp.sentenceSentiments,
    adjectiveDensity: Math.round((adjCount / totalTokens) * 1000) / 10,
    nounDensity: Math.round((nounCount / totalTokens) * 1000) / 10,
    passiveEstimate: Math.round(
      ((auxCount + verbCount) > 0 ? auxCount / (auxCount + verbCount) : 0) * 100,
    ),
    pronounRatio: Math.round((pronCount / totalTokens) * 1000) / 10,
    entityDensity:
      Math.round((nlp.sentenceCount > 0 ? nlp.entities.length / nlp.sentenceCount : 0) * 100) /
      100,
  };
}