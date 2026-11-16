/**
 * Local writing analysis for prose and drafts.
 *
 * Everything here is deterministic and browser-local. The findings are
 * revision prompts, not verdicts: POV shifts, clichés, echoes, filter words and
 * figurative-language candidates all need a human reader's judgement.
 */
import { STOP_WORDS } from './stopwords';

export type PovChoice = 'auto' | 'first' | 'second' | 'third';
export type PovId = 'first' | 'second' | 'third' | 'mixed' | 'none';

export interface WritingOptions {
  pov?: PovChoice;
  /** Exclude quoted dialogue from POV counts and anomaly detection. Default true. */
  ignoreDialogue?: boolean;
}

export interface FrequencyEntry {
  word: string;
  count: number;
  per1000: number;
}

export interface WritingHit {
  key: string;
  label: string;
  count: number;
  examples: string[];
}

export interface PovAnomaly {
  sentenceIndex: number;
  expected: PovId;
  found: PovId[];
  text: string;
}

export interface PovReport {
  choice: PovChoice;
  detected: PovId;
  counts: Record<'first' | 'second' | 'third', number>;
  totalPronouns: number;
  anomalies: PovAnomaly[];
  dialogueExcluded: boolean;
}

export interface DialogueReport {
  segments: number;
  dialogueCharacters: number;
  narrationCharacters: number;
  dialogueRatio: number;
  said: number;
  saidBookisms: WritingHit;
  adverbTags: WritingHit;
}

export interface SentenceRhythm {
  total: number;
  short: number;
  medium: number;
  long: number;
  veryLong: number;
  average: number;
  longest: number;
}

export interface EchoHit {
  word: string;
  count: number;
  examples: { first: string; second: string; gap: number }[];
}

export interface WritingAnalysis {
  words: number;
  uniqueWords: number;
  uniqueContentWords: number;
  frequencies: FrequencyEntry[];
  contentFrequencies: FrequencyEntry[];
  topContentWords: FrequencyEntry[];
  synonyms: { word: string; count: number; suggestions: string[] }[];
  echoes: EchoHit[];
  sentenceOpeners: FrequencyEntry[];
  repeatedOpeners: FrequencyEntry[];
  conjunctionStarts: number;
  rhythm: SentenceRhythm;
  readability: {
    fleschReadingEase: number;
    fleschKincaidGrade: number;
    gunningFog: number;
  };
  adverbs: { total: number; per1000: number; top: FrequencyEntry[] };
  nominalizations: { total: number; per1000: number; top: FrequencyEntry[] };
  tics: WritingHit[];
  cliches: WritingHit[];
  similes: { count: number; examples: string[] };
  metaphors: { count: number; examples: string[] };
  pov: PovReport;
  dialogue: DialogueReport;
  notes: string[];
}

/* ── Tokenisation and sentences ──────────────────────────────── */

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

interface Token {
  word: string;
  index: number;
}

function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/’/g, "'").replace(/^'+|'+$/g, '');
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, 'gu');
  while ((match = re.exec(text)) !== null) {
    const word = normalizeWord(match[0]);
    if (word) tokens.push({ word, index: match.index });
  }
  return tokens;
}

interface Sentence {
  text: string;
  start: number;
  end: number;
}

function splitSentences(text: string): Sentence[] {
  try {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      return [...segmenter.segment(text)]
        .map((piece) => ({
          text: piece.segment.trim(),
          start: piece.index + piece.segment.indexOf(piece.segment.trim()),
          end: piece.index + piece.segment.length,
        }))
        .filter((sentence) => sentence.text.length > 0);
    }
  } catch {
    // Fall through to the regex splitter.
  }

  const sentences: Sentence[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (!trimmed) continue;
    const start = match.index + match[0].indexOf(trimmed);
    sentences.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return sentences;
}

function snippet(text: string, index: number, width = 64): string {
  const start = Math.max(0, index - width);
  const end = Math.min(text.length, index + width);
  const value = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${value}${end < text.length ? '…' : ''}`;
}

/* ── Dialogue spans ──────────────────────────────────────────── */

interface Span {
  start: number;
  end: number;
}

function dialogueSpans(text: string): Span[] {
  const spans: Span[] = [];
  let open = -1;
  let openChar = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' || char === '“' || char === '”') {
      if (open === -1) {
        open = index;
        openChar = char;
      } else if (char === '"' || (openChar === '“' && char === '”')) {
        spans.push({ start: open, end: index + 1 });
        open = -1;
        openChar = '';
      }
    }
  }
  if (open !== -1) spans.push({ start: open, end: text.length });

  // Em-dash dialogue lines are common in fiction.
  const lineRe = /^[\t ]*[—–][^\n]*/gm;
  let line: RegExpExecArray | null;
  while ((line = lineRe.exec(text)) !== null) {
    spans.push({ start: line.index, end: line.index + line[0].length });
  }

  return mergeSpans(spans);
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function maskSpans(text: string, spans: Span[]): string {
  if (spans.length === 0) return text;
  const characters = text.split('');
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) {
      if (characters[index] !== '\n') characters[index] = ' ';
    }
  }
  return characters.join('');
}

/* ── Word frequency and echoes ───────────────────────────────── */

function frequencyEntries(tokens: Token[], total: number, contentOnly: boolean): FrequencyEntry[] {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (contentOnly && (token.word.length < 3 || STOP_WORDS.has(token.word))) continue;
    counts.set(token.word, (counts.get(token.word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({
      word,
      count,
      per1000: total > 0 ? (count / total) * 1000 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

const ECHO_WINDOW = 75;

function findEchoes(text: string, tokens: Token[]): EchoHit[] {
  const positions = new Map<string, Token[]>();
  for (const token of tokens) {
    if (token.word.length < 4 || STOP_WORDS.has(token.word)) continue;
    const list = positions.get(token.word) ?? [];
    list.push(token);
    positions.set(token.word, list);
  }

  const echoes: EchoHit[] = [];
  for (const [word, occurrences] of positions) {
    if (occurrences.length < 2) continue;
    let count = 0;
    const examples: EchoHit['examples'] = [];
    for (let index = 1; index < occurrences.length; index += 1) {
      const previous = occurrences[index - 1];
      const current = occurrences[index];
      const gap = indexDifference(tokens, previous, current);
      if (gap <= 0 || gap > ECHO_WINDOW) continue;
      count += 1;
      if (examples.length < 3) {
        examples.push({
          first: snippet(text, previous.index, 36),
          second: snippet(text, current.index, 36),
          gap,
        });
      }
    }
    if (count > 0) echoes.push({ word, count, examples });
  }

  return echoes.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, 30);
}

function indexDifference(tokens: Token[], a: Token, b: Token): number {
  // Token order is monotonic; binary search keeps this linear-ish for long texts.
  let low = 0;
  let high = tokens.length - 1;
  let aIndex = -1;
  let bIndex = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tokens[mid].index < a.index) low = mid + 1;
    else if (tokens[mid].index > a.index) high = mid - 1;
    else { aIndex = mid; break; }
  }
  low = 0;
  high = tokens.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tokens[mid].index < b.index) low = mid + 1;
    else if (tokens[mid].index > b.index) high = mid - 1;
    else { bIndex = mid; break; }
  }
  if (aIndex < 0 || bIndex < 0) return Number.POSITIVE_INFINITY;
  return bIndex - aIndex;
}

/* ── POV ─────────────────────────────────────────────────────── */

const POV_PRONOUNS: Record<'first' | 'second' | 'third', Set<string>> = {
  first: new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves']),
  second: new Set(['you', 'your', 'yours', 'yourself', 'yourselves']),
  third: new Set([
    'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them',
    'their', 'theirs', 'himself', 'herself', 'itself', 'themselves',
  ]),
};

const POV_BASES = new Map<string, 'first' | 'second' | 'third'>();
for (const [pov, pronouns] of Object.entries(POV_PRONOUNS) as Array<['first' | 'second' | 'third', Set<string>]>) {
  for (const pronoun of pronouns) POV_BASES.set(pronoun, pov);
}

function povOfWord(word: string): 'first' | 'second' | 'third' | undefined {
  return POV_BASES.get(word.split("'")[0]);
}

function countPovPronouns(text: string): Record<'first' | 'second' | 'third', number> {
  const counts = { first: 0, second: 0, third: 0 };
  for (const token of tokenize(text)) {
    const pov = povOfWord(token.word);
    if (pov) counts[pov] += 1;
  }
  return counts;
}

function detectPov(counts: Record<'first' | 'second' | 'third', number>): PovId {
  const entries = Object.entries(counts) as Array<['first' | 'second' | 'third', number]>;
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return 'none';
  const max = Math.max(...entries.map(([, count]) => count));
  const winners = entries.filter(([, count]) => count === max);
  return winners.length === 1 ? winners[0][0] : 'mixed';
}

function analyzePov(
  text: string,
  choice: PovChoice,
  ignoreDialogue: boolean,
): PovReport {
  const spans = dialogueSpans(text);
  const masked = ignoreDialogue ? maskSpans(text, spans) : text;
  const counts = countPovPronouns(masked);
  const detected = detectPov(counts);
  const expected: PovId = choice === 'auto' ? detected : choice;
  const anomalies: PovAnomaly[] = [];

  if (expected === 'first' || expected === 'second' || expected === 'third') {
    const sentences = splitSentences(text);
    sentences.forEach((sentence, sentenceIndex) => {
      const relevant = masked.slice(sentence.start, sentence.end);
      const found = new Set<'first' | 'second' | 'third'>();
      for (const token of tokenize(relevant)) {
        const pov = povOfWord(token.word);
        if (pov && pov !== expected) found.add(pov);
      }
      if (found.size > 0) {
        anomalies.push({
          sentenceIndex: sentenceIndex + 1,
          expected,
          found: [...found],
          text: sentence.text.length > 220 ? `${sentence.text.slice(0, 217)}…` : sentence.text,
        });
      }
    });
  }

  return {
    choice,
    detected,
    counts,
    totalPronouns: counts.first + counts.second + counts.third,
    anomalies: anomalies.slice(0, 40),
    dialogueExcluded: ignoreDialogue,
  };
}

/* ── Generic phrase/term matching ────────────────────────────── */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegex(term: string): RegExp {
  const escaped = escapeRegExp(term).replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'giu');
}

function findTerms(text: string, terms: string[]): { count: number; examples: string[] } {
  let count = 0;
  const examples: string[] = [];
  for (const term of terms) {
    const re = termRegex(term);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      count += 1;
      if (examples.length < 4 && !examples.includes(snippet(text, match.index, 48))) {
        examples.push(snippet(text, match.index, 48));
      }
    }
  }
  return { count, examples };
}

function hit(key: string, label: string, text: string, terms: string[]): WritingHit {
  const result = findTerms(text, terms);
  return { key, label, count: result.count, examples: result.examples };
}

/* ── Lexicons ────────────────────────────────────────────────── */

const CRUTCH_WORDS = [
  'just', 'really', 'very', 'actually', 'basically', 'literally', 'simply',
  'quite', 'rather', 'somewhat', 'perhaps', 'maybe', 'somehow', 'definitely',
  'certainly', 'absolutely', 'totally', 'completely', 'utterly', 'extremely',
  'incredibly', 'honestly', 'frankly', 'clearly', 'obviously', 'apparently',
  'essentially', 'practically', 'virtually', 'kind of', 'sort of', 'a bit',
  'a little', 'at the end of the day', 'needless to say', 'in fact',
  'of course', 'anyway', 'began to', 'started to',
];

const FILTER_WORDS = [
  'saw', 'heard', 'felt', 'noticed', 'realized', 'knew', 'thought', 'wondered',
  'watched', 'looked', 'seemed', 'appeared', 'decided', 'remembered',
  'understood', 'believed', 'hoped', 'feared', 'smelled', 'tasted', 'sensed',
];

const HEDGES = [
  'maybe', 'perhaps', 'possibly', 'probably', 'seems', 'appears', 'somewhat',
  'relatively', 'fairly', 'arguably', 'i think', 'i guess', 'sort of',
  'kind of', 'it seems', 'it appears',
];

const INTENSIFIERS = [
  'very', 'really', 'quite', 'rather', 'extremely', 'incredibly', 'absolutely',
  'totally', 'completely', 'utterly', 'highly', 'deeply', 'truly',
];

const TELLING_EMOTIONS = [
  'felt angry', 'felt sad', 'felt happy', 'felt scared', 'felt nervous',
  'felt excited', 'felt embarrassed', 'felt relieved', 'felt frustrated',
  'felt annoyed', 'felt jealous', 'felt guilty', 'felt proud', 'felt lonely',
  'was angry', 'was sad', 'was happy', 'was scared', 'was nervous',
  'was excited', 'was embarrassed', 'was relieved', 'was frustrated',
  'was annoyed', 'was jealous', 'was guilty', 'was proud', 'was lonely',
];

const BODY_CLICHES = [
  'heart pounded', 'heart raced', 'heart skipped a beat', 'heart hammered',
  'breath hitched', 'let out a breath', 'held her breath', 'held his breath',
  'held their breath', 'eyes widened', 'eyes narrowed', 'eyes flashed',
  'eyes darkened', 'eyes softened', 'rolled her eyes', 'rolled his eyes',
  'rolled their eyes', 'bit her lip', 'bit his lip', 'bit their lip',
  'chewed her lip', 'chewed his lip', 'chewed their lip', 'stomach dropped',
  'stomach churned', 'blood ran cold', 'shiver ran down', 'shivers down',
  'blinked back tears', 'tears streamed', 'a single tear', 'exhaled slowly',
  'let out a shaky breath', 'pinched the bridge of her nose',
  'pinched the bridge of his nose', 'ran a hand through her hair',
  'ran a hand through his hair', 'carded fingers through', 'jaw tightened',
  'knuckles whitened', 'fists clenched', 'gritted her teeth',
  'gritted his teeth', 'swallowed hard', 'cleared her throat',
  'cleared his throat', 'forced a smile', 'smile did not reach',
  "smile didn't reach", 'nodded slowly', 'shrugged', 'sighed',
  'smirked', 'frowned', 'looked away', 'stared into the distance',
];

const REDUNDANCIES = [
  'absolutely essential', 'advance planning', 'added bonus',
  'basic fundamentals', 'brief summary', 'close proximity',
  'collaborate together', 'completely destroyed', 'end result',
  'exact same', 'false pretense', 'final outcome', 'free gift',
  'future plans', 'join together', 'past history', 'personal opinion',
  'plan ahead', 'revert back', 'safe haven', 'same identical',
  'unexpected surprise', 'very unique', 'whether or not',
];

const WEASEL_WORDS = [
  'some people say', 'many people believe', 'experts agree', 'studies show',
  'research suggests', 'it is said', 'it has been said', 'according to some',
  'sources say', 'critics say', 'everyone knows',
];

const CLICHES = [
  'at the end of the day', 'avoid like the plague', 'beat around the bush',
  'better late than never', 'bite the bullet', 'blessing in disguise',
  'break the ice', 'calm before the storm', 'cost an arm and a leg',
  'crystal clear', 'dead as a doornail', 'deer in headlights',
  'dime a dozen', 'easy as pie', 'every cloud has a silver lining',
  'few and far between', 'fish out of water', 'fit as a fiddle',
  'give 110 percent', 'hit the nail on the head', 'in the nick of time',
  "it's not rocket science", 'last but not least',
  'let the cat out of the bag', 'light as a feather',
  'like a moth to a flame', 'needle in a haystack',
  'once in a blue moon', 'only time will tell', 'open a can of worms',
  'piece of cake', 'plain as day', 'pull yourself together',
  'quiet as a mouse', 'raining cats and dogs', 'read between the lines',
  'see the light', 'sight for sore eyes', 'spill the beans',
  'stick out like a sore thumb', 'take a deep breath',
  'the elephant in the room', 'the tip of the iceberg',
  'think outside the box', 'time will tell', 'under the weather',
  'when it rains it pours', 'without a doubt',
  "you can't judge a book by its cover", 'little did she know',
  'little did he know', 'little did they know', 'unbeknownst to',
  'time stood still', 'the world came crashing down', 'white as a sheet',
  'cold as ice', 'hard as nails', 'soft as silk', 'strong as an ox',
  'quiet as a tomb', 'dark as night', 'busy as a bee', 'blind as a bat',
  'deaf as a post', 'happy as a clam', 'pretty as a picture',
  'sharp as a tack', 'sly as a fox', 'wise as an owl',
  'worked like a charm', 'slept like a baby', 'fought like cats and dogs',
  'spread like wildfire', 'vanished into thin air', 'the moment of truth',
  'a matter of time', 'the writing on the wall', 'a blessing and a curse',
  'the lesser of two evils', 'the best of both worlds',
  'a double-edged sword', 'a slippery slope', 'a wake-up call',
  'the bottom line', 'a game changer', 'a level playing field',
  'a win-win', 'the quiet before the storm', 'a perfect storm',
  'a snowball effect', 'a vicious cycle', 'a recipe for disaster',
  'a shadow of its former self', 'a shell of a man', 'a ghost of a smile',
];

const SAID_BOOKISMS = [
  'exclaimed', 'declared', 'announced', 'remarked', 'observed', 'noted',
  'admitted', 'agreed', 'argued', 'promised', 'warned', 'grumbled',
  'snapped', 'hissed', 'breathed', 'laughed', 'smiled', 'grinned',
  'chuckled', 'murmured', 'muttered', 'whispered', 'shouted', 'yelled',
  'screamed', 'cried', 'insisted', 'explained', 'continued', 'added',
  'interrupted',
];

const ADVERB_EXCEPTIONS = new Set([
  'only', 'early', 'daily', 'weekly', 'monthly', 'yearly', 'family', 'apply',
  'reply', 'supply', 'multiply', 'imply', 'comply', 'rely', 'fly', 'july',
  'likely', 'friendly', 'lovely', 'lonely', 'silly', 'holy', 'ugly',
  'elderly', 'costly', 'deadly', 'leisurely', 'lively', 'orderly', 'timely',
  'worldly', 'burly', 'curly', 'surly', 'ghastly', 'italy', 'assembly',
  'anomaly', 'monopoly', 'melancholy',
]);

/* ── Figurative-language candidates ──────────────────────────── */

const SIMILE_PATTERNS = [
  /\b(?:like|as)\s+(?:a|an|the)\s+[\p{L}][\p{L}'-]*/giu,
  /\bas\s+[\p{L}][\p{L}'-]*\s+as\s+(?:a|an|the)?\s*[\p{L}][\p{L}'-]*/giu,
  /\b(?:as if|as though)\b[^.!?\n]{0,80}/giu,
];

const SIMILE_EXCLUSIONS = [
  'as a result', 'as a whole', 'as a rule', 'as a matter of fact',
  'as a general rule', 'as an example', 'as a consequence', 'as a group',
];

function collectPatternExamples(
  text: string,
  patterns: RegExp[],
  exclusions: string[] = [],
): { count: number; examples: string[] } {
  const seen = new Set<number>();
  const examples: string[] = [];
  let count = 0;

  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      if (seen.has(start)) continue;
      const phrase = match[0].toLowerCase();
      if (exclusions.some((exclusion) => phrase.startsWith(exclusion))) continue;
      seen.add(start);
      count += 1;
      if (examples.length < 5) examples.push(snippet(text, start, 52));
    }
  }
  return { count, examples };
}

const METAPHOR_PATTERNS = [
  /\b(?:was|is|are|were|am|be|been|being|became|becomes|seemed|seems)\s+(?:a|an|the)\s+[\p{L}][\p{L}'-]*/giu,
  /\b(?:his|her|their|my|your|its)\s+[\p{L}][\p{L}'-]*\s+(?:was|is|were|are)\s+(?:a|an|the)\s+[\p{L}][\p{L}'-]*/giu,
];

/* ── Readability ─────────────────────────────────────────────── */

function countSyllables(word: string): number {
  let value = word.toLowerCase().replace(/[^a-z]/g, '');
  if (value.length <= 3) return value.length > 0 ? 1 : 0;
  value = value
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = value.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

function readability(
  words: number,
  sentences: number,
  syllables: number,
  complexWords: number,
): WritingAnalysis['readability'] {
  if (words === 0) {
    return { fleschReadingEase: 0, fleschKincaidGrade: 0, gunningFog: 0 };
  }
  const safeSentences = Math.max(1, sentences);
  const wordsPerSentence = words / safeSentences;
  const syllablesPerWord = syllables / words;
  return {
    fleschReadingEase:
      Math.round((206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord) * 10) / 10,
    fleschKincaidGrade:
      Math.round((0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59) * 10) / 10,
    gunningFog:
      Math.round((0.4 * (wordsPerSentence + 100 * (complexWords / words))) * 10) / 10,
  };
}

/* ── Main analysis ───────────────────────────────────────────── */

export function analyzeWriting(text: string, options: WritingOptions = {}): WritingAnalysis {
  const choice: PovChoice = options.pov ?? 'auto';
  const ignoreDialogue = options.ignoreDialogue !== false;
  const tokens = tokenize(text);
  const words = tokens.length;
  const frequencies = frequencyEntries(tokens, words, false);
  const contentFrequencies = frequencyEntries(tokens, words, true);
  const topContentWords = contentFrequencies.slice(0, 20);
  const synonyms = topContentWords
    .map((entry) => ({ word: entry.word, count: entry.count, suggestions: suggestSynonyms(entry.word) }))
    .filter((entry) => entry.suggestions.length > 0)
    .slice(0, 12);

  const adverbs = frequencies.filter(
    (entry) => entry.word.endsWith('ly') && entry.word.length > 3 && !ADVERB_EXCEPTIONS.has(entry.word),
  );
  const adverbTotal = adverbs.reduce((sum, entry) => sum + entry.count, 0);

  const nominalizations = frequencies.filter(
    (entry) => entry.word.length >= 6 && /(?:tion|sion|ment|ance|ence|ity|ness|ism|ization)$/.test(entry.word),
  );
  const nominalizationTotal = nominalizations.reduce((sum, entry) => sum + entry.count, 0);

  const sentences = splitSentences(text);
  const sentenceTokenCounts = sentences.map((sentence) => tokenize(sentence.text).length);
  const rhythm: SentenceRhythm = {
    total: sentenceTokenCounts.length,
    short: sentenceTokenCounts.filter((count) => count <= 10).length,
    medium: sentenceTokenCounts.filter((count) => count > 10 && count <= 20).length,
    long: sentenceTokenCounts.filter((count) => count > 20 && count <= 35).length,
    veryLong: sentenceTokenCounts.filter((count) => count > 35).length,
    average:
      sentenceTokenCounts.length > 0
        ? Math.round((sentenceTokenCounts.reduce((sum, count) => sum + count, 0) / sentenceTokenCounts.length) * 10) / 10
        : 0,
    longest: sentenceTokenCounts.length > 0 ? Math.max(...sentenceTokenCounts) : 0,
  };

  const openerCounts = new Map<string, number>();
  let conjunctionStarts = 0;
  for (const sentence of sentences) {
    const first = tokenize(sentence.text)[0];
    if (!first) continue;
    openerCounts.set(first.word, (openerCounts.get(first.word) ?? 0) + 1);
    if (['and', 'but', 'so', 'because', 'or', 'yet', 'then'].includes(first.word)) {
      conjunctionStarts += 1;
    }
  }
  const sentenceOpeners = [...openerCounts.entries()]
    .map(([word, count]) => ({ word, count, per1000: rhythm.total > 0 ? (count / rhythm.total) * 1000 : 0 }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  const dialogue = dialogueSpans(text);
  const dialogueCharacters = dialogue.reduce((sum, span) => sum + (span.end - span.start), 0);
  const narrationCharacters = Math.max(0, text.length - dialogueCharacters);
  const saidCount = findTerms(text, ['said']).count;
  const adverbTags: WritingHit = {
    key: 'adverb-tags',
    label: 'Dialogue tags with adverbs',
    count: 0,
    examples: [],
  };
  const adverbTagRe = /\b(?:said|asked|replied|answered|whispered|shouted|muttered|murmured|yelled|screamed|cried|exclaimed|added|continued|began|insisted|explained|declared|announced|remarked|observed|noted|admitted|agreed|argued|promised|warned|grumbled|snapped|hissed|breathed|laughed|smiled|grinned|sighed|chuckled)\s+[\p{L}]+ly\b/giu;
  let adverbTagMatch: RegExpExecArray | null;
  while ((adverbTagMatch = adverbTagRe.exec(text)) !== null) {
    adverbTags.count += 1;
    if (adverbTags.examples.length < 4) {
      adverbTags.examples.push(snippet(text, adverbTagMatch.index, 44));
    }
  }

  const syllables = tokens.reduce((sum, token) => sum + countSyllables(token.word), 0);
  const complexWords = tokens.filter((token) => countSyllables(token.word) >= 3).length;

  const tics: WritingHit[] = [
    hit('crutch', 'Crutch / filler words', text, CRUTCH_WORDS),
    hit('filter', 'Filter words', text, FILTER_WORDS),
    hit('hedge', 'Hedges', text, HEDGES),
    hit('intensifier', 'Intensifiers', text, INTENSIFIERS),
    hit('telling', 'Emotion telling', text, TELLING_EMOTIONS),
    hit('body', 'Body / reaction clichés', text, BODY_CLICHES),
    hit('redundancy', 'Redundancies', text, REDUNDANCIES),
    hit('weasel', 'Weasel words', text, WEASEL_WORDS),
  ].filter((entry) => entry.count > 0);

  return {
    words,
    uniqueWords: new Set(tokens.map((token) => token.word)).size,
    uniqueContentWords: new Set(
      tokens
        .filter((token) => token.word.length >= 3 && !STOP_WORDS.has(token.word))
        .map((token) => token.word),
    ).size,
    frequencies,
    contentFrequencies,
    topContentWords,
    synonyms,
    echoes: findEchoes(text, tokens),
    sentenceOpeners,
    repeatedOpeners: sentenceOpeners.filter((entry) => entry.count >= 2).slice(0, 20),
    conjunctionStarts,
    rhythm,
    readability: readability(words, sentences.length, syllables, complexWords),
    adverbs: {
      total: adverbTotal,
      per1000: words > 0 ? (adverbTotal / words) * 1000 : 0,
      top: adverbs.slice(0, 20),
    },
    nominalizations: {
      total: nominalizationTotal,
      per1000: words > 0 ? (nominalizationTotal / words) * 1000 : 0,
      top: nominalizations.slice(0, 15),
    },
    tics,
    cliches: (() => {
      const result = findTerms(text, CLICHES);
      return result.count > 0
        ? [{ key: 'cliche', label: 'Clichés', count: result.count, examples: result.examples }]
        : [];
    })(),
    similes: collectPatternExamples(text, SIMILE_PATTERNS, SIMILE_EXCLUSIONS),
    metaphors: collectPatternExamples(text, METAPHOR_PATTERNS),
    pov: analyzePov(text, choice, ignoreDialogue),
    dialogue: {
      segments: dialogue.length,
      dialogueCharacters,
      narrationCharacters,
      dialogueRatio: text.length > 0 ? dialogueCharacters / text.length : 0,
      said: saidCount,
      saidBookisms: hit('said-bookisms', 'Said-bookisms', text, SAID_BOOKISMS),
      adverbTags,
    },
    notes: [
      'Findings are revision prompts, not verdicts. Read each hit in context.',
      'POV counts exclude quoted dialogue by default; dialogue can legitimately use other pronouns.',
      'Simile and metaphor counts match grammatical candidates, not understood figurative meaning.',
      'A cliché can be deliberate. The counter flags repetition, not bad taste.',
    ],
  };
}

/* ── Offline synonym suggestions ─────────────────────────────── */

const SYNONYM_MAP: Record<string, string[]> = {
  said: ['replied', 'answered', 'murmured', 'added', 'whispered', 'called'],
  asked: ['inquired', 'wondered', 'questioned', 'probed', 'requested'],
  replied: ['answered', 'responded', 'returned', 'countered'],
  answered: ['replied', 'responded', 'returned', 'countered'],
  looked: ['glanced', 'stared', 'watched', 'studied', 'peered', 'examined'],
  saw: ['noticed', 'glimpsed', 'spotted', 'observed', 'caught sight of'],
  watched: ['observed', 'studied', 'tracked', 'surveyed', 'eyed'],
  walked: ['strode', 'strolled', 'trudged', 'paced', 'wandered', 'marched'],
  ran: ['sprinted', 'dashed', 'bolted', 'hurried', 'fled', 'raced'],
  moved: ['shifted', 'stepped', 'slid', 'drifted', 'advanced', 'withdrew'],
  turned: ['pivoted', 'rotated', 'swiveled', 'twisted', 'angled'],
  smiled: ['grinned', 'beamed', 'smirked', 'smiled faintly', 'lit up'],
  laughed: ['chuckled', 'giggled', 'snickered', 'guffawed', 'huffed'],
  cried: ['wept', 'sobbed', 'wailed', 'teared up', 'broke down'],
  thought: ['mused', 'considered', 'reflected', 'reasoned', 'supposed'],
  felt: ['sensed', 'experienced', 'perceived', 'registered', 'noticed'],
  knew: ['understood', 'recognized', 'realized', 'grasped', 'was certain'],
  realized: ['understood', 'recognized', 'grasped', 'saw', 'registered'],
  noticed: ['spotted', 'observed', 'caught', 'detected', 'registered'],
  wanted: ['wished', 'longed', 'craved', 'desired', 'needed'],
  needed: ['required', 'needed badly', 'depended on', 'called for'],
  began: ['started', 'commenced', 'launched into', 'set about', 'opened'],
  started: ['began', 'commenced', 'set off', 'launched', 'kicked off'],
  stopped: ['halted', 'ceased', 'paused', 'broke off', 'came to a stop'],
  continued: ['carried on', 'resumed', 'persisted', 'kept on', 'proceeded'],
  went: ['headed', 'traveled', 'moved', 'departed', 'made for'],
  came: ['arrived', 'approached', 'returned', 'appeared', 'drew near'],
  got: ['received', 'obtained', 'caught', 'earned', 'grabbed'],
  took: ['seized', 'grabbed', 'claimed', 'accepted', 'carried off'],
  gave: ['offered', 'handed', 'provided', 'granted', 'bestowed'],
  made: ['created', 'built', 'formed', 'produced', 'crafted'],
  put: ['placed', 'set', 'laid', 'positioned', 'dropped'],
  found: ['discovered', 'located', 'uncovered', 'spotted', 'stumbled on'],
  kept: ['held', 'retained', 'preserved', 'maintained', 'stored'],
  left: ['departed', 'exited', 'abandoned', 'withdrew from', 'went out of'],
  brought: ['carried', 'delivered', 'fetched', 'transported', 'ushered in'],
  held: ['gripped', 'clutched', 'carried', 'supported', 'contained'],
  sat: ['settled', 'perched', 'lowered himself', 'took a seat', 'slumped'],
  stood: ['rose', 'remained upright', 'planted himself', 'lingered', 'waited'],
  big: ['large', 'substantial', 'immense', 'sizeable', 'considerable'],
  small: ['tiny', 'slight', 'compact', 'modest', 'diminutive'],
  large: ['vast', 'expansive', 'substantial', 'broad', 'roomy'],
  little: ['small', 'slight', 'tiny', 'brief', 'modest'],
  good: ['fine', 'sound', 'skillful', 'decent', 'effective'],
  bad: ['poor', 'flawed', 'harmful', 'dismal', 'unfortunate'],
  great: ['excellent', 'remarkable', 'considerable', 'notable', 'superb'],
  important: ['significant', 'consequential', 'critical', 'weighty', 'essential'],
  beautiful: ['lovely', 'striking', 'elegant', 'radiant', 'exquisite'],
  ugly: ['hideous', 'unsightly', 'repulsive', 'grotesque', 'drab'],
  happy: ['glad', 'content', 'delighted', 'cheerful', 'buoyant'],
  sad: ['sorrowful', 'downcast', 'melancholy', 'mournful', 'wretched'],
  angry: ['furious', 'irate', 'livid', 'indignant', 'seething'],
  scared: ['afraid', 'frightened', 'alarmed', 'terrified', 'uneasy'],
  afraid: ['scared', 'frightened', 'alarmed', 'uneasy', 'fearful'],
  tired: ['weary', 'exhausted', 'drained', 'fatigued', 'spent'],
  excited: ['eager', 'thrilled', 'animated', 'elated', 'restless'],
  nervous: ['anxious', 'jittery', 'uneasy', 'tense', 'apprehensive'],
  calm: ['composed', 'serene', 'steady', 'placid', 'collected'],
  quiet: ['hushed', 'still', 'muted', 'subdued', 'silent'],
  loud: ['booming', 'deafening', 'thunderous', 'blaring', 'raucous'],
  bright: ['brilliant', 'luminous', 'radiant', 'vivid', 'gleaming'],
  dark: ['dim', 'shadowy', 'gloomy', 'murky', 'unlit'],
  cold: ['chilly', 'frigid', 'icy', 'brisk', 'frosty'],
  hot: ['sweltering', 'scorching', 'blazing', 'heated', 'stifling'],
  fast: ['swift', 'rapid', 'brisk', 'fleet', 'quick'],
  slow: ['sluggish', 'gradual', 'leisurely', 'plodding', 'unhurried'],
  hard: ['difficult', 'demanding', 'strenuous', 'tough', 'laborious'],
  soft: ['gentle', 'supple', 'muted', 'yielding', 'velvety'],
  strong: ['powerful', 'sturdy', 'robust', 'forceful', 'resolute'],
  weak: ['frail', 'fragile', 'faint', 'feeble', 'tenuous'],
  old: ['aged', 'elderly', 'weathered', 'venerable', 'long-standing'],
  young: ['youthful', 'juvenile', 'fresh', 'callow', 'budding'],
  new: ['fresh', 'recent', 'novel', 'unfamiliar', 'modern'],
  strange: ['odd', 'peculiar', 'curious', 'unsettling', 'bizarre'],
  weird: ['odd', 'peculiar', 'eerie', 'uncanny', 'off-putting'],
  interesting: ['intriguing', 'notable', 'absorbing', 'curious', 'compelling'],
  very: ['extremely', 'remarkably', 'especially', 'particularly', 'decidedly'],
  really: ['genuinely', 'truly', 'decidedly', 'positively', 'veritably'],
  just: ['merely', 'only', 'simply', 'barely', 'exactly'],
  suddenly: ['abruptly', 'without warning', 'in an instant', 'all at once', 'swiftly'],
  then: ['next', 'afterward', 'subsequently', 'at that point', 'soon after'],
  finally: ['at last', 'eventually', 'ultimately', 'in the end', 'at length'],
  almost: ['nearly', 'practically', 'virtually', 'all but', 'about'],
  nearly: ['almost', 'practically', 'virtually', 'approximately', 'close to'],
  quite: ['rather', 'fairly', 'decidedly', 'somewhat', 'altogether'],
  rather: ['quite', 'somewhat', 'fairly', 'instead', 'preferably'],
  maybe: ['perhaps', 'possibly', 'conceivably', 'it may be', 'who knows'],
  perhaps: ['maybe', 'possibly', 'conceivably', 'arguably', 'it may be'],
  thing: ['object', 'matter', 'detail', 'element', 'issue'],
  things: ['objects', 'matters', 'details', 'elements', 'issues'],
  stuff: ['material', 'items', 'belongings', 'details', 'substance'],
  something: ['an object', 'a detail', 'a presence', 'a thing', 'an element'],
  anything: ['any object', 'any detail', 'any element', 'whatever', 'a thing'],
  nothing: ['no object', 'no detail', 'emptiness', 'silence', 'a void'],
  everyone: ['every person', 'all of them', 'the whole group', 'the crowd', 'each one'],
  someone: ['a person', 'an individual', 'a figure', 'a stranger', 'one of them'],
  anyone: ['any person', 'anyone at all', 'a single person', 'whoever', 'one person'],
  place: ['location', 'site', 'spot', 'setting', 'area'],
  area: ['region', 'zone', 'space', 'district', 'vicinity'],
  room: ['chamber', 'space', 'quarters', 'interior', 'hall'],
  house: ['home', 'residence', 'building', 'dwelling', 'property'],
  street: ['road', 'avenue', 'lane', 'thoroughfare', 'block'],
  city: ['town', 'metropolis', 'municipality', 'urban center', 'settlement'],
  way: ['manner', 'method', 'route', 'approach', 'fashion'],
  nice: ['pleasant', 'kind', 'agreeable', 'considerate', 'charming'],
  fine: ['acceptable', 'satisfactory', 'delicate', 'subtle', 'sound'],
  okay: ['acceptable', 'adequate', 'fine', 'passable', 'satisfactory'],
  crucial: ['essential', 'critical', 'vital', 'decisive', 'pivotal'],
  vital: ['essential', 'crucial', 'critical', 'indispensable', 'fundamental'],
  massive: ['enormous', 'colossal', 'immense', 'vast', 'monumental'],
  huge: ['enormous', 'immense', 'gigantic', 'colossal', 'vast'],
  tiny: ['minute', 'minuscule', 'slight', 'microscopic', 'diminutive'],
  giant: ['enormous', 'colossal', 'immense', 'towering', 'gigantic'],
  gorgeous: ['stunning', 'radiant', 'exquisite', 'breathtaking', 'lovely'],
  stunning: ['striking', 'breathtaking', 'remarkable', 'dazzling', 'arresting'],
};

export function suggestSynonyms(word: string): string[] {
  return SYNONYM_MAP[normalizeWord(word)] ?? [];
}

export const WRITING_LEXICON_COUNTS = {
  crutchWords: CRUTCH_WORDS.length,
  filterWords: FILTER_WORDS.length,
  hedges: HEDGES.length,
  intensifiers: INTENSIFIERS.length,
  bodyCliches: BODY_CLICHES.length,
  redundancies: REDUNDANCIES.length,
  cliches: CLICHES.length,
  synonyms: Object.keys(SYNONYM_MAP).length,
};
