// All wink-nlp imports happen dynamically inside getNlp() to prevent
// top-level crashes that take down the entire app.

// Lazy singleton
let _nlp: ReturnType<typeof import('wink-nlp')['default']> | null = null;
let _initAttempted = false;
let _initError: string | null = null;

async function getNlp() {
  if (_nlp) return _nlp;
  if (_initAttempted) return null;
  _initAttempted = true;
  try {
    const winkModule = await import('wink-nlp');
    const modelModule = await import('wink-eng-lite-web-model');
    // CJS interop: default may be nested or may be the module itself
    const winkNLP = (winkModule as any).default ?? winkModule;
    const model = (modelModule as any).default ?? modelModule;
    _nlp = winkNLP(model);
    return _nlp;
  } catch (err) {
    _initError = err instanceof Error ? err.message : String(err);
    console.error('[winkNlp] Init failed:', _initError);
    return null;
  }
}

export function getWinkStatus(): { initialized: boolean; error: string | null } {
  return { initialized: _nlp !== null, error: _initError };
}

export interface NlpAnalysis {
  sentiment: number;
  sentenceCount: number;
  tokenCount: number;
  posDistribution: Record<string, number>;
  entities: { text: string; type: string }[];
  sentenceSentiments: number[];
}

export const POS_LABELS: Record<string, string> = {
  ADJ: 'Adjective',
  ADP: 'Adposition',
  ADV: 'Adverb',
  AUX: 'Auxiliary',
  CCONJ: 'Conjunction',
  DET: 'Determiner',
  INTJ: 'Interjection',
  NOUN: 'Noun',
  NUM: 'Numeral',
  PART: 'Particle',
  PRON: 'Pronoun',
  PROPN: 'Proper Noun',
  PUNCT: 'Punctuation',
  SCONJ: 'Subordinating Conj',
  SYM: 'Symbol',
  VERB: 'Verb',
  X: 'Other',
  SPACE: 'Space',
};

// Cache the last NLP result so callers don't need to await repeatedly
let _lastText = '';
let _lastResult: NlpAnalysis | null = null;

export async function analyzeWithNlp(text: string): Promise<NlpAnalysis | null> {
  if (!text || text.trim().length === 0) return null;

  // Return cached result for same text
  if (text === _lastText) return _lastResult;

  const nlp = await getNlp();
  if (!nlp) return null;

  try {
    const its = nlp.its;
    const doc = nlp.readDoc(text);

    const sentiment = doc.out(its.sentiment) as number;

    const sentences = doc.sentences();
    const sentenceCount = sentences.length();
    const sentenceSentiments: number[] = [];
    sentences.each((s: import('wink-nlp').ItemSentence) => {
      try {
        const sentText = s.out() as string;
        const sentDoc = nlp.readDoc(sentText);
        sentenceSentiments.push(sentDoc.out(its.sentiment) as number);
      } catch {
        sentenceSentiments.push(0);
      }
    });

    const tokens = doc.tokens();
    const tokenCount = tokens.length();
    const posRaw = tokens.out(its.pos) as string[];
    const posDistribution: Record<string, number> = {};
    for (const pos of posRaw) {
      posDistribution[pos] = (posDistribution[pos] ?? 0) + 1;
    }

    const entities: { text: string; type: string }[] = [];
    doc.entities().each((e: import('wink-nlp').ItemEntity) => {
      entities.push({
        text: e.out(),
        type: e.out(its.type) as string,
      });
    });

    const result: NlpAnalysis = {
      sentiment,
      sentenceCount,
      tokenCount,
      posDistribution,
      entities,
      sentenceSentiments,
    };

    _lastText = text;
    _lastResult = result;
    return result;
  } catch (err) {
    console.error('[winkNlp] Analysis failed:', err);
    return null;
  }
}
