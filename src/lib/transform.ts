/* ── Text Transformation Engine ────────────────────────────────── */
// Stripper/obfuscator + unsloper — all pure functions, no side effects.

// ── Stripper / Obfuscator ───────────────────────────────────────

export interface StripperOptions {
  anonymizeNames: boolean;
  anonymizeEmails: boolean;
  anonymizePhones: boolean;
  anonymizeUrls: boolean;
  stripMarkdown: boolean;
  stripHtml: boolean;
  stripLineNumbers: boolean;
  stripBom: boolean;
  stripNonPrintable: boolean;
  normalizeWhitespace: boolean;
  normalizeLineEndings: boolean;
  trimTrailingWhitespace: boolean;
  collapseMultipleBlankLines: boolean;
}

export const STRIPPER_PRESETS: Record<string, Partial<StripperOptions>> = {
  anonymize: {
    anonymizeNames: true,
    anonymizeEmails: true,
    anonymizePhones: true,
    anonymizeUrls: true,
  },
  clean: {
    stripMarkdown: true,
    stripHtml: true,
    stripLineNumbers: true,
    stripBom: true,
    stripNonPrintable: true,
    normalizeWhitespace: true,
    normalizeLineEndings: true,
    trimTrailingWhitespace: true,
    collapseMultipleBlankLines: true,
  },
  full: {
    anonymizeNames: true,
    anonymizeEmails: true,
    anonymizePhones: true,
    anonymizeUrls: true,
    stripMarkdown: true,
    stripHtml: true,
    stripLineNumbers: true,
    stripBom: true,
    stripNonPrintable: true,
    normalizeWhitespace: true,
    normalizeLineEndings: true,
    trimTrailingWhitespace: true,
    collapseMultipleBlankLines: true,
  },
};

export const STRIPPER_DEFAULTS: StripperOptions = {
  anonymizeNames: false,
  anonymizeEmails: false,
  anonymizePhones: false,
  anonymizeUrls: false,
  stripMarkdown: false,
  stripHtml: false,
  stripLineNumbers: false,
  stripBom: false,
  stripNonPrintable: false,
  normalizeWhitespace: false,
  normalizeLineEndings: false,
  trimTrailingWhitespace: false,
  collapseMultipleBlankLines: false,
};

export function applyStripper(text: string, opts: StripperOptions): string {
  let result = text;

  // BOM first (before anything else reads it)
  if (opts.stripBom) result = result.replace(/^\uFEFF/, '');

  // Line endings
  if (opts.normalizeLineEndings) result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Line numbers (e.g. "  42: some text" or "42\ttext")
  if (opts.stripLineNumbers) result = result.replace(/^\s*\d+[:\t]\s?/gm, '');

  // Non-printable / control characters (keep \n \t \r)
  if (opts.stripNonPrintable) result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // HTML
  if (opts.stripHtml) result = stripHtmlTags(result);

  // Markdown
  if (opts.stripMarkdown) result = stripMarkdownSyntax(result);

  // Anonymization
  if (opts.anonymizeEmails) result = result.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  if (opts.anonymizePhones) result = result.replace(/(?:\+?\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 7 ? '[PHONE]' : match;
  });
  if (opts.anonymizeUrls) result = result.replace(/https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/g, '[URL]');
  if (opts.anonymizeNames) result = anonymizeNames(result);

  // Whitespace normalization
  if (opts.normalizeWhitespace) {
    result = result.replace(/ {2,}/g, ' ');
    result = result.replace(/\t/g, '    ');
  }
  if (opts.trimTrailingWhitespace) result = result.replace(/[ \t]+$/gm, '');
  if (opts.collapseMultipleBlankLines) result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

function stripHtmlTags(text: string): string {
  // Decode common HTML entities first
  let result = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Remove tags
  result = result.replace(/<[^>]+>/g, ' ');
  return result;
}

function stripMarkdownSyntax(text: string): string {
  let result = text;
  // Headers: ### Title → Title
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Bold/italic: **bold** → bold, *italic* → italic, ___ → _
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  result = result.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
  // Strikethrough: ~~text~~ → text
  result = result.replace(/~~([^~]+)~~/g, '$1');
  // Inline code: `code` → code
  result = result.replace(/`([^`]+)`/g, '$1');
  // Links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Images: ![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // Blockquotes: > text → text
  result = result.replace(/^>\s+/gm, '');
  // Horizontal rules: --- or *** or ___
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');
  // Unordered list markers: - or * at start
  result = result.replace(/^[\s]*[-*+]\s+/gm, '');
  // Ordered list markers: 1. at start
  result = result.replace(/^[\s]*\d+\.\s+/gm, '');
  return result;
}

function anonymizeNames(text: string): string {
  // Heuristic: capitalized words that look like names (2-3 words, both capitalized, not at sentence start)
  // This is imperfect — better than nothing for a browser-only tool.
  return text.replace(/(?<=[.!?]\s+|^)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?=[.,;:!?\s])/g, (match) => {
    // Don't replace common proper nouns / months / days
    const lower = match.toLowerCase();
    const keep = new Set([
      'january', 'february', 'march', 'april', 'may', 'june', 'july',
      'august', 'september', 'october', 'november', 'december',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
      'america', 'europe', 'asia', 'africa', 'australia',
      'english', 'spanish', 'french', 'german', 'chinese', 'japanese',
      'the', 'and', 'for', 'not', 'but', 'with', 'from', 'this', 'that',
      'linux', 'windows', 'macos', 'google', 'microsoft', 'apple',
    ]);
    if (keep.has(lower)) return match;
    return '[NAME]';
  });
}

// ── Unsloper ─────────────────────────────────────────────────────

export interface UnslopResult {
  text: string;
  patternsFound: UnslopPattern[];
  changeCount: number;
  originalLength: number;
  transformedLength: number;
}

export interface UnslopPattern {
  phrase: string;
  category: string;
  replacement: string | null; // null = removed entirely
  count: number;
}

// Phrase → replacement map (lowercase keys)
const UNSLOP_REPLACEMENTS: Record<string, string> = {
  // Throat-clearing openers
  'it is important to note': '',
  'it is worth noting': '',
  'it is crucial to understand': '',
  'it goes without saying': '',
  'needless to say': '',
  'without further ado': '',
  'in today\'s world': '',
  'in the realm of': '',
  'in this essay': '',
  'this article will': '',
  'as we delve': '',
  'let us delve': '',
  'buckle up': '',
  'dive deep': '',
  'at the end of the day': '',

  // Filler transitions
  'furthermore': '',
  'moreover': '',
  'in addition': '',
  'additionally': '',
  'consequently': '',
  'nevertheless': '',
  'nonetheless': '',
  'accordingly': '',
  'subsequently': '',

  // Inflated importance
  'game changer': 'significant change',
  'holistic approach': 'comprehensive approach',
  'synergy': 'coordination',
  'leverage': 'use',
  'paradigm shift': 'change',
  'cutting edge': 'latest',
  'state of the art': 'modern',

  // Verbose → direct
  'serves as a testament to': 'shows',
  'stands as a reminder': 'reminds us',
  'plays a crucial role': 'matters',
  'plays a pivotal role': 'matters',
  'plays a vital role': 'matters',
  'plays a significant role': 'matters',
  'plays a key role': 'matters',
  'underscores its importance': 'matters',
  'underscores its significance': 'matters',
  'reflects broader': 'shows',
  'symbolizing its': 'showing its',
  'contributing to the': 'helping the',
  'setting the stage for': 'leading to',
  'marking a shift': 'changing',
  'shaping the': 'influencing the',
  'key turning point': 'turning point',
  'evolving landscape': 'changing field',
  'focal point': 'focus',
  'indelible mark': 'lasting effect',
  'deeply rooted': 'established',

  // Highlighting/ensuring
  'highlighting the': 'showing the',
  'underscoring the': 'showing the',
  'emphasizing the': 'showing the',
  'ensuring that': 'making sure',
  'reflecting the': 'showing the',
  'symbolizing the': 'showing the',
  'cultivating': 'building',
  'fostering': 'building',
  'encompassing': 'including',
  'enhancing': 'improving',
  'valuable insights': 'useful information',
  'align with': 'match',
  'resonate with': 'connect with',

  // Verbose single words
  'boasts': 'has',
  'bolstered': 'strengthened',
  'crucial': 'important',
  'deep dive': 'look',
  'delve': 'look',
  'emphasizing': 'showing',
  'enduring': 'lasting',
  'enhance': 'improve',
  'garner': 'get',
  'highlight': 'show',
  'interplay': 'interaction',
  'intricate': 'complex',
  'intricacies': 'complexities',
  'landscape': 'field',
  'meticulous': 'careful',
  'meticulously': 'carefully',
  'pivotal': 'key',
  'robust': 'strong',
  'showcase': 'show',
  'tapestry': 'mix',
  'testament': 'proof',
  'underscore': 'show',
  'vibrant': 'active',

  // Structural
  'despite its': 'although it',
  'faces several challenges': 'has challenges',
  'despite these challenges': 'despite this',
  'challenges and legacy': 'history',
  'future outlook': 'outlook',

  // Chatbot / helpfulness
  'i hope this helps': '',
  'of course!': '',
  'certainly!': '',
  'you\'re absolutely right!': '',
  'would you like': '',
  'is there anything else': '',
  'let me know': '',
  'more detailed breakdown': 'more detail',
  'here is a': 'a',

  // Wikipedia / encyclopedia
  'adheres to': 'follows',
  'ensured that': 'made sure',
  'streamlined': 'simplified',
  'in compliance with': 'following',
  'complies with': 'follows',
  'encyclopedic tone': 'neutral tone',

  // Marketing
  'boasts a vibrant': 'has a',
  'exemplifies commitment to': 'shows dedication to',
  'natural beauty': 'beauty',
  'nestled in the heart of': 'in',
  'groundbreaking': 'new',
  'renowned': 'well-known',
  'featuring diverse array': 'with many',
  'profound': 'deep',
  'showcasing': 'showing',
};

// Sentence-starting transition words to flag
const TRANSITION_STARTERS = new Set([
  'additionally', 'furthermore', 'moreover', 'consequently',
  'nevertheless', 'nonetheless', 'accordingly', 'subsequently',
]);

export function detectUnslopPatterns(text: string): UnslopPattern[] {
  const lower = text.toLowerCase();
  const patterns: UnslopPattern[] = [];

  for (const [phrase, replacement] of Object.entries(UNSLOP_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      patterns.push({
        phrase,
        category: categorizePhrase(phrase),
        replacement: replacement || '(remove)',
        count: matches.length,
      });
    }
  }

  // Em dash overuse
  const emDashCount = (text.match(/—/g) ?? []).length;
  if (emDashCount > 3) {
    patterns.push({
      phrase: `em dashes (${emDashCount} occurrences)`,
      category: 'punctuation',
      replacement: 'reduce to 1-2',
      count: emDashCount,
    });
  }

  // Bold overuse
  const boldCount = (text.match(/\*\*[^*]+\*\*/g) ?? []).length;
  if (boldCount > 5) {
    patterns.push({
      phrase: `bold formatting (${boldCount} instances)`,
      category: 'formatting',
      replacement: 'reduce',
      count: boldCount,
    });
  }

  // Dash separators
  const dashSepCount = (text.match(/^[-=_]{3,}$/gm) ?? []).length;
  if (dashSepCount > 0) {
    patterns.push({
      phrase: `dash separators (${dashSepCount})`,
      category: 'formatting',
      replacement: '(remove)',
      count: dashSepCount,
    });
  }

  return patterns;
}

export function applyUnslop(text: string, patterns?: UnslopPattern[]): UnslopResult {
  const detected = patterns ?? detectUnslopPatterns(text);
  let result = text;
  let changeCount = 0;

  for (const pat of detected) {
    if (pat.replacement === '(remove)') {
      // Remove entire lines that are just dashes
      if (pat.category === 'formatting' && pat.phrase.startsWith('dash separators')) {
        const before = result;
        result = result.replace(/^[-=_]{3,}\s*$/gm, '');
        if (result !== before) changeCount++;
      }
      continue;
    }

    if (pat.replacement === 'reduce') {
      // Bold: reduce ** ** to just the text
      if (pat.category === 'formatting' && pat.phrase.startsWith('bold')) {
        const before = result;
        result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
        if (result !== before) changeCount++;
      }
      continue;
    }

    if (pat.replacement === 'reduce to 1-2') {
      // Em dashes: keep first 2, replace rest with commas
      let count = 0;
      const before = result;
      result = result.replace(/—/g, (match) => {
        count++;
        return count <= 2 ? match : ', ';
      });
      if (result !== before) changeCount++;
      continue;
    }

    // Text replacement
    const regex = new RegExp(`\\b${escapeRegex(pat.phrase)}\\b`, 'gi');
    const before = result;
    result = result.replace(regex, pat.replacement!);
    if (result !== before) changeCount++;
  }

  // Clean up double spaces from removed phrases
  result = result.replace(/ {2,}/g, ' ');
  // Clean up leading punctuation artifacts (", the" → "the")
  result = result.replace(/^\s*[,.]\s*/gm, '');
  // Clean up empty lines left by removals
  result = result.replace(/\n{3,}/g, '\n\n');

  return {
    text: result.trim(),
    patternsFound: detected,
    changeCount,
    originalLength: text.length,
    transformedLength: result.trim().length,
  };
}

function categorizePhrase(phrase: string): string {
  if (['furthermore', 'moreover', 'additionally', 'consequently', 'nevertheless', 'nonetheless', 'accordingly', 'subsequently'].includes(phrase)) return 'transition';
  if (['leverage', 'utilize', 'boasts', 'bolstered', 'delve', 'showcase', 'tapestry', 'robust', 'pivotal', 'landscape', 'intricate'].includes(phrase)) return 'verbose synonym';
  if (['game changer', 'holistic approach', 'synergy', 'paradigm shift', 'cutting edge', 'state of the art'].includes(phrase)) return 'buzzword';
  if (['serves as a testament', 'plays a crucial role', 'underscores its importance', 'setting the stage for'].includes(phrase)) return 'inflated importance';
  if (['i hope this helps', 'of course!', 'certainly!', 'would you like', 'is there anything else'].includes(phrase)) return 'chatbot';
  if (['adheres to', 'streamlined', 'in compliance with', 'encyclopedic tone'].includes(phrase)) return 'encyclopedia';
  if (['groundbreaking', 'renowned', 'featuring diverse array', 'exemplifies commitment to'].includes(phrase)) return 'marketing';
  return 'other';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
