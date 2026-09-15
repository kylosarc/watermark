import type { ItemSentence, ItemEntity, Model, WinkMethods } from 'wink-nlp';

// Lazy singleton — only instantiate once, on first call
let _nlp: WinkMethods | null = null;
let _loadError = false;

async function getNlp(): Promise<WinkMethods | null> {
  if (_loadError) return null;
  if (_nlp) return _nlp;
  try {
    const { default: winkNLP } = await import('wink-nlp');
    const { default: model } = await import('wink-eng-lite-web-model');
    _nlp = winkNLP(model as Model);
    return _nlp;
  } catch {
    _loadError = true;
    return null;
  }
}

export interface NlpAnalysis {
  sentiment: number; // -1 to 1
  sentenceCount: number;
  tokenCount: number;
  posDistribution: Record<string, number>;
  entities: { text: string; type: string }[];
  sentenceSentiments: number[];
}

const POS_LABELS: Record<string, string> = {
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

export { POS_LABELS };

export async function analyzeWithNlp(text: string): Promise<NlpAnalysis | null> {
  if (!text || text.trim().length === 0) return null;

  const nlp = await getNlp();
  if (!nlp) return null;

  try {
    const its = nlp.its;
    const doc = nlp.readDoc(text);

    // Sentiment
    const sentiment = doc.out(its.sentiment) as number;

    // Sentences + sentence-level sentiment
    const sentences = doc.sentences();
    const sentenceCount = sentences.length();
    const sentenceSentiments: number[] = [];
    sentences.each((s: ItemSentence) => {
      const span = s.out(its.span) as number[];
      sentenceSentiments.push(nlp.its.sentiment(span) as number);
    });

    // Tokens + POS distribution
    const tokens = doc.tokens();
    const tokenCount = tokens.length();
    const posRaw = tokens.out(its.pos) as string[];
    const posDistribution: Record<string, number> = {};
    for (const pos of posRaw) {
      posDistribution[pos] = (posDistribution[pos] ?? 0) + 1;
    }

    // Entities
    const entities: { text: string; type: string }[] = [];
    doc.entities().each((e: ItemEntity) => {
      entities.push({
        text: e.out(),
        type: e.out(its.type) as string,
      });
    });

    return {
      sentiment,
      sentenceCount,
      tokenCount,
      posDistribution,
      entities,
      sentenceSentiments,
    };
  } catch {
    return null;
  }
}
