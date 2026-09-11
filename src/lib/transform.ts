/* ── Text Transformation Engine ────────────────────────────────── */
// Stripper/obfuscator + unsloper — all pure functions, no side effects.
// Rules adapted from watermark-cleaner (MIT) by pixelstrunk.

// ── Invisible Character Rules (from watermark-cleaner/rules/characters.json) ──

const INVISIBLE_CHARS_ALWAYS_REMOVE = [
  '\u200B', // zero width space
  '\u2060', // word joiner
  '\uFEFF', // BOM / zero width no-break space
  '\u00AD', // soft hyphen
  '\u180E', // mongolian vowel separator
  '\u034F', // combining grapheme joiner
  '\u2061', // function application
  '\u2062', // invisible times
  '\u2063', // invisible separator
  '\u2064', // invisible plus
  '\u3164', // hangul filler
  '\uFFA0', // halfwidth hangul filler
];

const INVISIBLE_CHARS_RANGES: Array<{ from: string; to: string }> = [
  { from: 'E0000', to: 'E007F' }, // unicode tag characters (hidden payload)
  { from: '206A', to: '206F' },   // deprecated format characters
  { from: 'FFF9', to: 'FFFB' },   // interlinear annotation characters
];

// Exotic spaces → normal space
const EXOTIC_SPACES = new Set([
  '\u00A0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
  '\u202F', '\u205F', '\u3000',
  '\u2028', '\u2029', // line/paragraph separator
  '\u2800',           // braille blank
]);

// Bidi control characters (Trojan Source defense for LTR docs)
const BIDI_CHARS = new Set([
  '\u200E', '\u200F', '\u061C', // LRM, RLM, ALM
]);
const BIDI_CONTROL_RANGES: Array<{ from: string; to: string }> = [
  { from: '202A', to: '202E' }, // bidi embedding/override
  { from: '2066', to: '2069' }, // bidi isolate
];

// ── Typography Rules (from watermark-cleaner/rules/typography.json) ──

const SMART_QUOTES: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
  '\u2039': "'", '\u203A': "'", '\u00AB': '"', '\u00BB': '"',
};

const PUNCTUATION_NORMALIZE: Record<string, string> = {
  '\u2026': '...',  // ellipsis
  '\u2024': '.',    // leader dot
  '\u2025': '..',   // double leader dot
  '\u2022': '-',    // bullet
  '\u2023': '-',    // triangular bullet
  '\u25E6': '-',    // white bullet
  '\u2043': '-',    // hyphen bullet
  '\u2219': '-',    // bullet operator
  '\u00B7': '-',    // middle dot
};

// ── Homoglyph Rules (from watermark-cleaner/rules/homoglyphs.json) ──

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic → Latin
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041A': 'K',
  '\u041C': 'M', '\u041D': 'H', '\u041E': 'O', '\u0420': 'P',
  '\u0421': 'C', '\u0422': 'T', '\u0423': 'Y', '\u0425': 'X',
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i',
  '\u0455': 's', '\u0458': 'j', '\u04BB': 'h',
  // Greek → Latin
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z',
  '\u0397': 'H', '\u0399': 'I', '\u039A': 'K', '\u039C': 'M',
  '\u039D': 'N', '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T',
  '\u03A5': 'Y', '\u03A7': 'X', '\u03BF': 'o', '\u03B1': 'a',
  // Other lookalikes
  '\u0501': 'd', '\u0405': 'S', '\u0406': 'I', '\u0408': 'J',
  '\u04AE': 'Y', '\u2C7C': 'j',
};

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
  // watermark-cleaner additions
  stripInvisibleChars: boolean;
  normalizeTypography: boolean;
  detectHomoglyphs: boolean;
  stripBidiControls: boolean;
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
    stripInvisibleChars: true,
    normalizeTypography: true,
    normalizeWhitespace: true,
    normalizeLineEndings: true,
    trimTrailingWhitespace: true,
    collapseMultipleBlankLines: true,
  },
  publish: {
    stripInvisibleChars: true,
    normalizeTypography: true,
    detectHomoglyphs: true,
    stripBidiControls: true,
    stripBom: true,
    stripNonPrintable: true,
    normalizeWhitespace: true,
    normalizeLineEndings: true,
    trimTrailingWhitespace: true,
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
    stripInvisibleChars: true,
    normalizeTypography: true,
    detectHomoglyphs: true,
    stripBidiControls: true,
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
  stripInvisibleChars: false,
  normalizeTypography: false,
  detectHomoglyphs: false,
  stripBidiControls: false,
};

export function applyStripper(text: string, opts: StripperOptions): string {
  let result = text;

  // BOM first (before anything else reads it)
  if (opts.stripBom) result = result.replace(/^\uFEFF/, '');

  // Invisible characters (watermark-cleaner rules)
  if (opts.stripInvisibleChars) result = removeInvisibleChars(result);

  // Bidi controls (Trojan Source defense)
  if (opts.stripBidiControls) result = removeBidiControls(result);

  // Typography normalization (smart quotes, dashes, ellipsis)
  if (opts.normalizeTypography) result = normalizeTypography(result);

  // Homoglyph replacement (Cyrillic/Greek lookalikes)
  if (opts.detectHomoglyphs) result = replaceHomoglyphs(result);

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

// ── Invisible Character Removal (watermark-cleaner rules) ───────

function removeInvisibleChars(text: string): string {
  let result = text;

  // Remove always-invisible characters
  for (const ch of INVISIBLE_CHARS_ALWAYS_REMOVE) {
    result = result.replaceAll(ch, '');
  }

  // Remove invisible character ranges
  for (const range of INVISIBLE_CHARS_RANGES) {
    const start = parseInt(range.from, 16);
    const end = parseInt(range.to, 16);
    const regex = new RegExp(`[${String.fromCodePoint(start)}-${String.fromCodePoint(end)}]`, 'g');
    result = result.replace(regex, '');
  }

  // Replace exotic spaces with normal space
  for (const sp of EXOTIC_SPACES) {
    result = result.replaceAll(sp, ' ');
  }

  // Collapse multiple spaces created by removals
  result = result.replace(/ {2,}/g, ' ');

  return result;
}

// ── Bidi Control Removal (Trojan Source defense) ────────────────

function removeBidiControls(text: string): string {
  let result = text;

  for (const ch of BIDI_CHARS) {
    result = result.replaceAll(ch, '');
  }

  for (const range of BIDI_CONTROL_RANGES) {
    const start = parseInt(range.from, 16);
    const end = parseInt(range.to, 16);
    const regex = new RegExp(`[${String.fromCodePoint(start)}-${String.fromCodePoint(end)}]`, 'g');
    result = result.replace(regex, '');
  }

  return result;
}

// ── Typography Normalization (watermark-cleaner rules) ──────────

function normalizeTypography(text: string): string {
  let result = text;

  // Smart quotes → ASCII
  for (const [smart, ascii] of Object.entries(SMART_QUOTES)) {
    result = result.replaceAll(smart, ascii);
  }

  // Punctuation normalization (ellipsis, bullets, etc.)
  for (const [unicode, ascii] of Object.entries(PUNCTUATION_NORMALIZE)) {
    result = result.replaceAll(unicode, ascii);
  }

  // Em dash (—) and en dash (–) → comma or hyphen per context
  // Spaced em/en dash → comma: "fast — slow" → "fast, slow"
  result = result.replace(/\s+[—–]\s+/g, ', ');
  // Unspaced em/en dash → hyphen
  result = result.replace(/[—–]/g, '-');

  return result;
}

// ── Homoglyph Detection ─────────────────────────────────────────

export interface HomoglyphResult {
  found: boolean;
  replacements: Array<{ original: string; replacement: string; position: number }>;
  summary: string;
}

export function detectHomoglyphs(text: string): HomoglyphResult {
  const replacements: Array<{ original: string; replacement: string; position: number }> = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (HOMOGLYPHS[ch]) {
      replacements.push({
        original: ch,
        replacement: HOMOGLYPHS[ch],
        position: i,
      });
    }
  }

  return {
    found: replacements.length > 0,
    replacements,
    summary: replacements.length > 0
      ? `Found ${replacements.length} homoglyph(s): ${[...new Set(replacements.map(r => `${r.original}→${r.replacement}`))].join(', ')}`
      : 'No homoglyphs detected',
  };
}

export function replaceHomoglyphs(text: string): string {
  let result = text;
  for (const [unicode, ascii] of Object.entries(HOMOGLYPHS)) {
    result = result.replaceAll(unicode, ascii);
  }
  return result;
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
// Merged from watermark-cleaner/rules/phrases.json + our own extensions
const UNSLOP_REPLACEMENTS: Record<string, string> = {
  // Throat-clearing openers (watermark-cleaner + custom)
  'it is important to note': '',
  'it is worth noting': '',
  'it\'s important to note': '',
  'it\'s worth noting': '',
  'it bears mentioning': '',
  'it is crucial to understand': '',
  'it goes without saying': '',
  'needless to say': '',
  'without further ado': '',
  'in today\'s world': '',
  'in today\'s fast-paced world': '',
  'in today\'s digital age': '',
  'in the ever-evolving landscape': '',
  'in the realm of': '',
  'at the heart of': '',
  'in this essay': '',
  'this article will': '',
  'as we delve': '',
  'let us delve': '',
  'buckle up': '',
  'dive deep': '',
  'dive into': '',
  'dive in': '',
  'let\'s dive in': '',
  'let\'s explore': '',
  'let\'s unpack': '',
  'take a closer look': '',
  'at the end of the day': '',
  'in conclusion': '',
  'in summary': '',
  'when it comes to': '',

  // Navigation phrases (watermark-cleaner)
  'navigate the landscape of': '',
  'navigate the world of': '',
  'navigate the complexities of': '',

  // Journey / unlock phrases (watermark-cleaner)
  'embark on a journey': '',
  'unlock the secrets': '',
  'unlock the power': '',
  'unlock the potential': '',
  'master the art of': '',
  'push the boundaries': '',
  'break new ground': '',
  'paving the way': '',
  'breaking barriers': '',

  // Treasure / tapestry / beacon (watermark-cleaner)
  'a treasure trove of': '',
  'a tapestry of': '',
  'a testament to': '',
  'a myriad of': '',
  'a plethora of': '',
  'beacon of': '',
  'rich tapestry': '',
  'at the forefront of': '',
  'fostering a culture of': '',
  'demystify': '',

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
  'indeed': '',
  'in essence': '',
  'that said': '',

  // Inflated importance
  'game changer': 'significant change',
  'game-changer': 'significant change',
  'game-changing': 'significant',
  'holistic approach': 'comprehensive approach',
  'synergy': 'coordination',
  'leverage': 'use',
  'paradigm shift': 'change',
  'cutting edge': 'latest',
  'cutting-edge': 'latest',
  'state of the art': 'modern',
  'revolutionize the way': 'change how',
  'constantly evolving': 'changing',

  // Verbose → direct
  'serves as a testament to': 'shows',
  'serves as a reminder': 'reminds us',
  'stands as a testament': 'shows',
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
  'designed to enhance': 'improves',
  'whether you\'re a beginner or a seasoned pro': '',
  'you\'re not alone': '',
  'imagine a world where': '',

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

  // Verbose single words (watermark-cleaner lexicon + custom)
  'boasts': 'has',
  'bolstered': 'strengthened',
  'crucial': 'important',
  'deep dive': 'look',
  'delve': 'look',
  'delve into': 'look at',
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
  'unveil': 'reveal',
  'unleash': 'release',
  'harness': 'use',
  'elevate': 'raise',
  'illuminate': 'show',
  'traverse': 'cross',
  'redefine': 'change',
  'transcend': 'go beyond',
  'captivate': 'engage',
  'exemplify': 'show',
  'encompass': 'include',
  'seamless': 'smooth',
  'innovative': 'new',
  'comprehensive': 'complete',
  'multifaceted': 'complex',
  'nuanced': 'subtle',
  'profound': 'deep',
  'transformative': 'powerful',
  'remarkable': 'notable',
  'dynamic': 'active',
  'ever-evolving': 'changing',
  'bespoke': 'custom',
  'curated': 'selected',
  'underpinnings': 'foundation',
  'ecosystem': 'system',
  'paradigm': 'model',
  'cornerstone': 'foundation',
  'hallmark': 'sign',
  'mosaic': 'mix',
  'utilize': 'use',
  'streamline': 'simplify',
  'operationalize': 'implement',
  'ideate': ' brainstorm',
  'poised to': 'ready to',

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

  // Sentence shapes (from watermark-cleaner)
  const sentenceShapes: Array<{ id: string; regex: RegExp; example: string }> = [
    { id: 'this-isnt-this-is', regex: /this\s+is\s?n['']?t\b[^.!?]{0,80}[.!?]\s+this\s+is\b/gi, example: "This isn't a tool. This is a movement." },
    { id: 'its-not-just-its-about', regex: /it['']?s\s+not\s+just\s+about\b[^.!?]{0,80},\s*it['']?s\s+about\b/gi, example: "It's not just about code, it's about craft." },
    { id: 'its-not-just-its-also', regex: /it['']?s\s+not\s+just\b[^.!?]{0,80},\s*it['']?s\s+also\b/gi, example: "It's not just planning, it's also psychology." },
    { id: 'not-only-but-also', regex: /\bnot\s+only\b[^.!?]{0,80}\bbut\s+also\b/gi, example: "Not only fast, but also reliable." },
    { id: 'stop-thinking-start-thinking', regex: /\bstop\s+thinking\b[^.!?]{0,60}(?:[.!?]\s+[^.!?]{0,60})?\bstart\s+thinking\b/gi, example: "Stop thinking features. Start thinking jobs." },
    { id: 'is-dead-is-the-future', regex: /\bis\s+dead\b[^.!?]{0,60}(?:[.!?]\s+[^.!?]{0,60})?\bis\s+the\s+future\b/gi, example: "Agile is dead. Flow is the future." },
    { id: 'the-question-isnt', regex: /the\s+question\s+is\s?n['']?t\b[^.!?]{0,80}(?:[.!?]\s+[^.!?]{0,80})?the\s+question\s+is\b/gi, example: "The question isn't how. The question is why." },
    { id: 'you-dont-need-you-need', regex: /\byou\s+do\s?n['']?t\s+need\b[^.!?]{0,60}(?:[.!?]\s+[^.!?]{0,60})?\byou\s+need\b/gi, example: "You don't need more tools. You need focus." },
    { id: 'isnt-merely-its', regex: /is\s?n['']?t\s+merely\b[^.!?]{0,80}it['']?s\b/gi, example: "This isn't merely a method, it's a worldview." },
    { id: 'this-is-where-comes-in', regex: /this\s+is\s+where\b[^.!?]{0,60}\bcomes\s+in\b/gi, example: "This is where user story mapping comes in." },
    { id: 'less-x-more-y', regex: /\bless\s+\w+,\s+more\s+\w+\b/gi, example: "Less talking, more shipping." },
  ];

  for (const shape of sentenceShapes) {
    const matches = text.match(shape.regex);
    if (matches && matches.length > 0) {
      patterns.push({
        phrase: `sentence shape: ${shape.id} (${matches[0].slice(0, 60)}…)`,
        category: 'sentence shape',
        replacement: 'rewrite needed',
        count: matches.length,
      });
    }
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
  if (['furthermore', 'moreover', 'additionally', 'consequently', 'nevertheless', 'nonetheless', 'accordingly', 'subsequently', 'indeed', 'in essence', 'that said'].includes(phrase)) return 'transition';
  if (['leverage', 'utilize', 'boasts', 'bolstered', 'delve', 'showcase', 'tapestry', 'robust', 'pivotal', 'landscape', 'intricate', 'unveil', 'unleash', 'harness', 'elevate', 'illuminate', 'transcend', 'captivate', 'seamless', 'innovative', 'comprehensive', 'multifaceted', 'nuanced', 'profound', 'dynamic', 'bespoke', 'curated', 'ecosystem', 'paradigm', 'cornerstone', 'hallmark', 'streamline', 'utilize', 'poised to'].includes(phrase)) return 'verbose synonym';
  if (['game changer', 'game-changer', 'game-changing', 'holistic approach', 'synergy', 'paradigm shift', 'cutting edge', 'cutting-edge', 'state of the art', 'revolutionize the way', 'constantly evolving'].includes(phrase)) return 'buzzword';
  if (['serves as a testament', 'serves as a reminder', 'stands as a testament', 'stands as a reminder', 'plays a crucial role', 'plays a pivotal role', 'plays a vital role', 'plays a significant role', 'plays a key role', 'underscores its importance', 'underscores its significance', 'setting the stage for', 'a testament to', 'at the forefront of'].includes(phrase)) return 'inflated importance';
  if (['i hope this helps', 'of course!', 'certainly!', 'would you like', 'is there anything else', 'let me know', 'imagine a world where', 'you\'re not alone'].includes(phrase)) return 'chatbot';
  if (['adheres to', 'streamlined', 'in compliance with', 'encyclopedic tone', 'ensured that', 'complies with'].includes(phrase)) return 'encyclopedia';
  if (['groundbreaking', 'renowned', 'featuring diverse array', 'exemplifies commitment to', 'boasts a vibrant', 'nestled in the heart of', 'natural beauty'].includes(phrase)) return 'marketing';
  if (['in today\'s fast-paced world', 'in today\'s digital age', 'in the ever-evolving landscape', 'navigate the landscape of', 'navigate the world of', 'navigate the complexities of', 'embark on a journey', 'unlock the secrets', 'unlock the power', 'unlock the potential', 'master the art of', 'push the boundaries', 'break new ground', 'paving the way', 'breaking barriers', 'a treasure trove of', 'a tapestry of', 'a myriad of', 'a plethora of', 'beacon of', 'rich tapestry', 'fostering a culture of', 'demystify', 'without further ado', 'buckle up'].includes(phrase)) return 'AI pattern';
  return 'other';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
