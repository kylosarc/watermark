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
  // PII redaction
  stripSSN: boolean;
  stripCreditCards: boolean;
  stripBankAccounts: boolean;
  stripDriversLicense: boolean;
  stripPassport: boolean;
  stripTaxIds: boolean;
  stripApiKeys: boolean;
  stripPasswords: boolean;
  stripAddresses: boolean;
  stripIban: boolean;
  // Formatting
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
    stripSSN: true,
    stripCreditCards: true,
    stripBankAccounts: true,
    stripDriversLicense: true,
    stripPassport: true,
    stripTaxIds: true,
    stripApiKeys: true,
    stripPasswords: true,
    stripAddresses: true,
    stripIban: true,
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
  redact: {
    anonymizeNames: true,
    anonymizeEmails: true,
    anonymizePhones: true,
    anonymizeUrls: true,
    stripSSN: true,
    stripCreditCards: true,
    stripBankAccounts: true,
    stripDriversLicense: true,
    stripPassport: true,
    stripTaxIds: true,
    stripApiKeys: true,
    stripPasswords: true,
    stripAddresses: true,
    stripIban: true,
  },
  full: {
    anonymizeNames: true,
    anonymizeEmails: true,
    anonymizePhones: true,
    anonymizeUrls: true,
    stripSSN: true,
    stripCreditCards: true,
    stripBankAccounts: true,
    stripDriversLicense: true,
    stripPassport: true,
    stripTaxIds: true,
    stripApiKeys: true,
    stripPasswords: true,
    stripAddresses: true,
    stripIban: true,
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
  stripSSN: false,
  stripCreditCards: false,
  stripBankAccounts: false,
  stripDriversLicense: false,
  stripPassport: false,
  stripTaxIds: false,
  stripApiKeys: false,
  stripPasswords: false,
  stripAddresses: false,
  stripIban: false,
  // Clean defaults: enabled by default for sensible "strip text" behavior
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
  // Disabled by default
  detectHomoglyphs: false,
  stripBidiControls: false,
};

export function applyStripper(text: string, opts: StripperOptions): string {
  if (typeof text !== 'string') return '';
  let result = text;

  // Each step is individually guarded — one failure doesn't break the rest
  const safe = (fn: () => string, fallback: string = result) => {
    try { return fn(); } catch { return fallback; }
  };

  // BOM first (before anything else reads it)
  if (opts.stripBom) result = safe(() => result.replace(/^\uFEFF/, ''));

  // Invisible characters (watermark-cleaner rules)
  if (opts.stripInvisibleChars) result = safe(() => removeInvisibleChars(result));

  // Bidi controls (Trojan Source defense)
  if (opts.stripBidiControls) result = safe(() => removeBidiControls(result));

  // Typography normalization (smart quotes, dashes, ellipsis)
  if (opts.normalizeTypography) result = safe(() => normalizeTypography(result));

  // Homoglyph replacement (Cyrillic/Greek lookalikes)
  if (opts.detectHomoglyphs) result = safe(() => replaceHomoglyphs(result));

  // Line endings
  if (opts.normalizeLineEndings) result = safe(() => result.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

  // Line numbers (e.g. "  42: some text" or "42\ttext")
  if (opts.stripLineNumbers) result = safe(() => result.replace(/^\s*\d+[:\t]\s?/gm, ''));

  // Non-printable / control characters (keep \n \t \r)
  if (opts.stripNonPrintable) result = safe(() => result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''));

  // HTML
  if (opts.stripHtml) result = safe(() => stripHtmlTags(result));

  // Markdown
  if (opts.stripMarkdown) result = safe(() => stripMarkdownSyntax(result));

  // Anonymization
  if (opts.anonymizeEmails) result = safe(() => result.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'));
  if (opts.anonymizePhones) result = safe(() => result.replace(/(?:\+?\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 7 ? '[PHONE]' : match;
  }));
  if (opts.anonymizeUrls) result = safe(() => result.replace(/https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/g, '[URL]'));
  if (opts.anonymizeNames) result = safe(() => anonymizeNames(result));

  // PII Redaction
  if (opts.stripSSN) result = safe(() => redactSSN(result));
  if (opts.stripCreditCards) result = safe(() => redactCreditCards(result));
  if (opts.stripBankAccounts) result = safe(() => redactBankAccounts(result));
  if (opts.stripDriversLicense) result = safe(() => redactDriversLicense(result));
  if (opts.stripPassport) result = safe(() => redactPassport(result));
  if (opts.stripTaxIds) result = safe(() => redactTaxIds(result));
  if (opts.stripApiKeys) result = safe(() => redactApiKeys(result));
  if (opts.stripPasswords) result = safe(() => redactPasswords(result));
  if (opts.stripAddresses) result = safe(() => redactAddresses(result));
  if (opts.stripIban) result = safe(() => redactIban(result));

  // Whitespace normalization
  if (opts.normalizeWhitespace) {
    result = safe(() => result.replace(/ {2,}/g, ' '));
    result = safe(() => result.replace(/\t/g, '    '));
  }
  if (opts.trimTrailingWhitespace) result = safe(() => result.replace(/[ \t]+$/gm, ''));
  if (opts.collapseMultipleBlankLines) result = safe(() => result.replace(/\n{3,}/g, '\n\n'));

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

// ── PII Redaction ──────────────────────────────────────────────

function redactSSN(text: string): string {
  // US Social Security Numbers: 123-45-6789 or 123 45 6789 or 123456789
  return text.replace(/\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 9 && !digits.startsWith('000') && !digits.startsWith('666') && parseInt(digits.slice(0, 3)) <= 899) {
      return '[SSN]';
    }
    return match;
  });
}

function redactCreditCards(text: string): string {
  // Credit card numbers: 4111-1111-1111-1111, 4111 1111 1111 1111, 4111111111111111
  // Supports Visa (4xxx), Mastercard (5[1-5]xx, 2[2-7]xx), Amex (3[47]xx), Discover (6011, 65xx)
  return text.replace(/\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2}|6011|65\d{2})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 16 || digits.length === 15) {
      // Basic Luhn check
      if (luhnCheck(digits)) return '[CREDIT_CARD]';
    }
    return match;
  });
}

function luhnCheck(num: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function redactBankAccounts(text: string): string {
  // US bank account numbers: 8-17 digits, often with dashes or spaces
  // Also catches routing numbers (9 digits) followed by account numbers
  return text.replace(/\b(?:routing(?:\s*#?)?:?\s*)?(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,5})\b/gi, (match, captured) => {
    const digits = captured.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 17) {
      return '[BANK_ACCOUNT]';
    }
    return match;
  });
}

function redactDriversLicense(text: string): string {
  // US driver's license: typically 1-14 alphanumeric characters, format varies by state
  // Common patterns: 1 letter + 4-12 digits, or 5-14 digits
  return text.replace(/\b(?:driver'?s?\s*(?:licen[sc]e|lic\.?|dl\.?)\s*(?:#|num(?:ber)?|no\.?)?\s*:?\s*)([A-Z]\d{4,12}|\d{5,14})\b/gi, '[DRIVERS_LICENSE]');
}

function redactPassport(text: string): string {
  // US passport: 1 letter + 8 digits (e.g., C12345678)
  // UK passport: 9 digits (e.g., 123456789)
  return text.replace(/\b(?:passport(?:\s*(?:#|num(?:ber)?|no\.?))?\s*:?\s*)([A-Z]\d{8}|\d{9})\b/gi, '[PASSPORT]');
}

function redactTaxIds(text: string): string {
  // US EIN: XX-XXXXXXX (9 digits with dash after first 2)
  return text.replace(/\b\d{2}\s*[\-]\s*\d{7}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 9) return '[EIN]';
    return match;
  });
  // US ITIN: 9XX-XX-XXXX (starts with 9, 90-99 range)
}

function redactApiKeys(text: string): string {
  // Common API key patterns
  // AWS: AKIA[0-9A-Z]{16}
  // Generic: api[_\-]?key[_\-]?:?\s*[A-Za-z0-9\-_]{20,}
  // Bearer tokens
  let result = text;
  result = result.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[AWS_KEY]');
  result = result.replace(/\b(?:api[_\-]?key|apikey|api[_\-]?secret)\s*[:=]\s*['"]?([A-Za-z0-9\-_]{20,})['"]?/gi, '[API_KEY]');
  result = result.replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, '[API_KEY]');
  result = result.replace(/\bghp_[A-Za-z0-9]{36}\b/g, '[GITHUB_TOKEN]');
  result = result.replace(/\bglpat-[A-Za-z0-9\-_]{20,}\b/g, '[GITLAB_TOKEN]');
  result = result.replace(/\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g, '[SLACK_TOKEN]');
  return result;
}

function redactPasswords(text: string): string {
  // Password fields: password, passwd, pwd, secret followed by value
  return text.replace(/\b(?:password|passwd|pwd|secret|token|auth)\s*[:=]\s*['"]?([^\s'"<>]{6,})['"]?/gi, '[PASSWORD]');
}

function redactAddresses(text: string): string {
  // US street addresses: 123 Main St, 123 Main Street, 123 Main Ave, etc.
  return text.replace(/\b\d{1,5}\s+(?:[A-Z][a-zA-Z]*\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Way|Ln|Lane|Ct|Court|Pl(?:ace)?|Pkwy|Parkway|Cir(?:cle)?)\.?(?:\s*,?\s*(?:Apt|Suite|Ste|Unit|#)\s*\d+)?\b/gi, '[ADDRESS]');
}

function redactIban(text: string): string {
  // IBAN: 2 letter country code + 2 check digits + up to 30 alphanumeric
  return text.replace(/\b[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?(?:[\dA-Z]{4}[\s]?){1,7}[\dA-Z]{1,4}\b/g, (match) => {
    const stripped = match.replace(/\s/g, '');
    if (stripped.length >= 15 && stripped.length <= 34 && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(stripped)) {
      return '[IBAN]';
    }
    return match;
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
  if (typeof text !== 'string') return '';
  let result = text;

  // Smart quotes → ASCII
  for (const [smart, ascii] of Object.entries(SMART_QUOTES)) {
    result = result.replaceAll(smart, ascii);
  }

  // Punctuation normalization (ellipsis, bullets, etc.)
  for (const [unicode, ascii] of Object.entries(PUNCTUATION_NORMALIZE)) {
    result = result.replaceAll(unicode, ascii);
  }

  // Em dash (—) and en dash (–) → hyphen per context
  // Spaced em/en dash → spaced hyphen: "word — word" → "word - word"
  result = result.replace(/\s+[—–]\s+/g, ' - ');
  // Unspaced em/en dash → hyphen
  result = result.replace(/[—–]/g, '-');

  return result;
}

// ── PDF Text Normalization ────────────────────────────────────────
// PDFs often extract with letter-spacing artifacts (e.g., "K Y L O S A R C")
// and scientific notation that grammar checkers don't understand.
// This normalizes PDF text before Harper runs.

// Protect patterns that should NOT be collapsed or modified
const PDF_PROTECT_PATTERNS: RegExp[] = [
  // Chemical formulas: H2O, C6H12O6, NaCl, Fe2O3, CO2
  /\b[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*\b/g,
  // Scientific notation: 3.0 x 10^8, 1.5e-3
  /\d+\.?\d*\s*[x×]\s*10\^?\d+/gi,
  /\d+\.?\d*e[+-]?\d+/gi,
  // Units with numbers: 25°C, 0.1 M, 180.16 g/mol
  /\d+\.?\d*\s*(?:°[CFK]|[kcm]?(?:g|mol|L|m|s|Hz|N|Pa|J|W|V|A|Ω))\b/g,
  // Math expressions: mc^2, E=mc^2
  /[A-Z]\s*=\s*[A-Za-z0-9^+\-*/().]+\b/g,
];

const PDF_LETTER_SPACED = /\b([A-Z])\s+([A-Z])\s+([A-Z])\b/g;

export function normalizePdfText(text: string): string {
  if (typeof text !== 'string') return '';
  let result = text;

  // Step 1: Protect scientific/chemical patterns by replacing with placeholders
  const protectedMap = new Map<string, string>();
  let placeholderIdx = 0;

  for (const pattern of PDF_PROTECT_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const key = `\x00PROTECTED_${placeholderIdx++}\x00`;
      protectedMap.set(key, match);
      return key;
    });
  }

  // Step 2: Collapse letter-spacing (K Y L O S A R C → KYLOSARC)
  // Match sequences of 3+ single uppercase letters separated by spaces
  result = result.replace(/(?:^|\s)(?:[A-Z]\s+){2,}[A-Z](?:\s|$)/g, (match) => {
    return match.replace(/\s+/g, '');
  });

  // Step 3: Normalize remaining whitespace
  result = result.replace(/ {2,}/g, ' ');

  // Step 4: Restore protected patterns
  for (const [key, value] of protectedMap) {
    result = result.replace(key, value);
  }

  return result.trim();
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

  // ── Expanded: Common verbose → direct ─────────────────────────
  'in order to': 'to',
  'for the purpose of': 'to',
  'with regard to': 'about',
  'in relation to': 'about',
  'with respect to': 'about',
  'in the event that': 'if',
  'due to the fact that': 'because',
  'on account of': 'because',
  'in light of': 'given',
  'for the reason that': 'because',
  'in the process of': '',
  'at this point in time': 'now',
  'at the present time': 'now',
  'in the near future': 'soon',
  'on a daily basis': 'daily',
  'on a regular basis': 'regularly',
  'on a weekly basis': 'weekly',
  'on a monthly basis': 'monthly',
  'in a timely manner': 'quickly',
  'in a timely fashion': 'quickly',
  'at an early date': 'soon',
  'until such time as': 'until',
  'after a period of time': 'after a while',
  'before long': 'soon',
  'a large number of': 'many',
  'a majority of': 'most',
  'a small number of': 'few',
  'a variety of': 'various',
  'an abundance of': 'many',
  'a wide range of': 'many',
  'a great deal of': 'much',
  'a significant amount of': 'much',
  'the vast majority of': 'most',
  'each and every': 'every',
  'one and only': 'sole',
  'first and foremost': 'first',
  'last but not least': 'finally',
  'over and over': 'repeatedly',
  'again and again': 'repeatedly',
  'time and time again': 'often',
  'by means of': 'by',
  'on the grounds that': 'because',
  'in the absence of': 'without',
  'in the vicinity of': 'near',
  'adjacent to': 'near',
  'in close proximity to': 'near',
  'prior to': 'before',
  'subsequent to': 'after',
  'in excess of': 'over',
  'the lion\'s share of': 'most',
  'bear in mind': 'remember',
  'take into consideration': 'consider',
  'give consideration to': 'consider',
  'arrive at a conclusion': 'conclude',
  'arrive at a decision': 'decide',
  'make a decision': 'decide',
  'make an assumption': 'assume',
  'conduct an investigation': 'investigate',
  'perform an analysis': 'analyze',
  'carry out': 'do',
  'bring about': 'cause',
  'give rise to': 'cause',
  'result in': 'cause',
  'lead to': 'cause',
  'be responsible for': 'cause',
  'make use of': 'use',
  'avail oneself of': 'use',
  'put into practice': 'implement',
  'take action': 'act',
  'take steps': 'act',
  'make improvements': 'improve',
  'make changes': 'change',
  'make modifications': 'modify',
  'in the final analysis': 'ultimately',
  'when all is said and done': 'ultimately',

  // ── Expanded: Weak verbs → strong verbs ───────────────────────
  'is able to': 'can',
  'has the ability to': 'can',
  'has the capacity to': 'can',
  'has the potential to': 'can',
  'is in a position to': 'can',
  'is capable of': 'can',
  'tends to': '',
  'is inclined to': '',
  'is likely to': 'will',
  'is unlikely to': 'probably won\'t',
  'appears to': '',
  'seems to': '',
  'has a tendency to': '',
  'is prone to': '',
  'is susceptible to': '',
  'is subject to': '',
  'goes through the process of': '',
  'engages in': '',
  'participates in': 'joins',
  'makes use of': 'uses',
  'takes advantage of': 'uses',
  'comes into contact with': 'meets',
  'places emphasis on': 'emphasizes',
  'gives consideration to': 'considers',
  'provides assistance to': 'helps',
  'renders assistance to': 'helps',
  'exerts influence on': 'influences',
  'has an impact on': 'affects',
  'has an effect on': 'affects',
  'serves the purpose of': '',
  'functions as': 'acts as',
  'operates as': 'acts as',
  'works as': 'acts as',

  // ── Expanded: Nominalizations → verbs ─────────────────────────
  'make an adjustment': 'adjust',
  'make a recommendation': 'recommend',
  'make a suggestion': 'suggest',
  'make a contribution': 'contribute',
  'make a determination': 'determine',
  'make a calculation': 'calculate',
  'make an error': 'err',
  'give an explanation': 'explain',
  'reach a conclusion': 'conclude',
  'reach an agreement': 'agree',
  'reach a decision': 'decide',
  'arrive at a solution': 'solve',
  'conduct a review': 'review',
  'perform a task': 'do a task',
  'carry out a plan': 'execute a plan',
  'undertake a project': 'start a project',
  'initiate a process': 'start a process',
  'terminate a process': 'end a process',
  'facilitate the process of': 'help',
  'implement a solution': 'solve',
  'utilize a method': 'use a method',
  'employ a strategy': 'use a strategy',
  'exhibit behavior': 'behave',
  'demonstrate knowledge': 'show knowledge',
  'display characteristics': 'show characteristics',
  'possess qualities': 'have qualities',
  'maintain records': 'keep records',
  'retain information': 'keep information',
  'preserve data': 'keep data',
  'sustain momentum': 'keep momentum',

  // ── Expanded: Filler / throat-clearing ────────────────────────
  'the fact that': '',
  'the reality is that': '',
  'the truth is that': '',
  'what happens is': '',
  'what this means is': '',
  'the thing is': '',
  'the point is': '',
  'the bottom line is': '',
  'the moral of the story is': '',
  'as a matter of fact': 'in fact',
  'for what it\'s worth': '',
  'having said that': '',
  'to be honest': '',
  'to be fair': '',
  'to be frank': '',
  'to put it simply': '',
  'to put it bluntly': '',
  'to say the least': '',
  'it should be noted': '',
  'it should be mentioned': '',
  'it should be pointed out': '',
  'it\'s worth noting that': '',
  'it\'s important to note that': '',
  'it\'s interesting to note that': '',
  'as you can see': '',
  'as we all know': '',
  'as is well known': '',
  'as the saying goes': '',
  'as they say': '',

  // ── Expanded: AI / chatbot patterns ───────────────────────────
  'let\'s take a closer look': '',
  'unlock the secrets of': 'discover',
  'unlock the power of': 'use',
  'unlock the potential of': 'use',
  'push the boundaries of': 'expand',
  'break new ground in': 'pioneer',
  'paving the way for': 'enabling',
  'breaking barriers in': 'advancing',
  'a cornucopia of': 'many',
  'in the ever-evolving landscape of': 'in the changing field of',
  'take your skills to the next level': 'improve your skills',
  'the sky is the limit': '',
  'think outside the box': 'be creative',
  'the possibilities are endless': '',
  'this is just the beginning': '',
  'the future is bright': '',
  'stay tuned': '',
  'watch this space': '',
  'on the cutting edge': 'leading',
  'ahead of the curve': 'leading',
  'ahead of the pack': 'leading',
  'industry-leading': 'top',
  'world-class': 'excellent',
  'best-in-class': 'excellent',
  'next-generation': 'new',
  'state-of-the-art': 'modern',
  'mission-critical': 'essential',
  'value-added': 'improved',
  'customer-centric': 'user-focused',
  'data-driven': 'evidence-based',
  'results-oriented': 'effective',
  'solution-oriented': 'practical',
  'forward-thinking': 'innovative',
  'future-proof': 'durable',
  'scalable': 'expandable',
  'frictionless': 'smooth',
  'effortless': 'easy',
  'intuitive': 'simple',
  'optimized': 'improved',
  'enhanced': 'improved',
  'augmented': 'added to',
  'leveraged': 'used',
  'utilized': 'used',
  'employed': 'used',
  'deployed': 'used',
  'implemented': 'done',
  'executed': 'done',
  'operationalized': 'done',
  'synergized': 'combined',
  'orchestrated': 'organized',
  'championed': 'supported',
  'spearheaded': 'led',
  'pioneered': 'started',
  'revolutionized': 'changed',
  'transformed': 'changed',
  'disrupted': 'changed',
  'innovated': 'improved',
  'accelerated': 'sped up',
  'amplified': 'increased',
  'maximized': 'increased',
  'minimized': 'reduced',
  'eliminated': 'removed',
  'mitigated': 'reduced',
  'addressed': 'handled',
  'tackled': 'handled',
  'approached': 'handled',
  'considered': 'thought about',
  'evaluated': 'assessed',
  'assessed': 'checked',
  'analyzed': 'examined',
  'investigated': 'checked',
  'explored': 'looked at',
  'examined': 'checked',
  'reviewed': 'checked',
  'scrutinized': 'checked',
  'diagnosed': 'identified',
  'identified': 'found',
  'discovered': 'found',
  'determined': 'decided',
  'established': 'set up',
  'instituted': 'started',
  'initiated': 'started',
  'commenced': 'started',
  'concluded': 'ended',
  'terminated': 'ended',
  'completed': 'finished',
  'finalized': 'finished',
  'wrapped up': 'finished',
  'wound up': 'finished',
};

// Sentence-starting transition words to flag
const TRANSITION_STARTERS = new Set([
  'additionally', 'furthermore', 'moreover', 'consequently',
  'nevertheless', 'nonetheless', 'accordingly', 'subsequently',
]);

export function detectUnslopPatterns(text: string): UnslopPattern[] {
  if (typeof text !== 'string') return [];
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

  // Deduplicate overlapping patterns: prefer longer phrases over shorter substrings
  // e.g. "let's dive in" should override "dive in"
  patterns.sort((a, b) => b.phrase.length - a.phrase.length);
  const kept: UnslopPattern[] = [];
  for (const pat of patterns) {
    const isSubstring = kept.some(k => k.phrase.includes(pat.phrase) || pat.phrase.includes(k.phrase));
    if (!isSubstring) {
      kept.push(pat);
    }
  }

  return kept;
}

export function applyUnslop(text: string, patterns?: UnslopPattern[]): UnslopResult {
  if (typeof text !== 'string') return { text: '', patternsFound: [], changeCount: 0, originalLength: 0, transformedLength: 0 };
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
        continue;
      }
      // Remove throat-clearing phrases, AI patterns, chatbot filler
      const regex = new RegExp(`\\b${escapeRegex(pat.phrase)}\\b\\s*`, 'gi');
      const before = result;
      result = result.replace(regex, '');
      if (result !== before) changeCount++;
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

  // Only run cleanup if actual changes were made (prevents corrupting unchanged text)
  if (changeCount > 0) {
    // Clean up double spaces from removed phrases
    result = result.replace(/ {2,}/g, ' ');
    // Clean up orphaned conjunctions at line start (only after removals)
    result = result.replace(/^\s*(?:and|or|but|so|yet)\s+/gm, '');
    // Clean up leading punctuation artifacts
    result = result.replace(/^\s*[,.:;]\s*/gm, '');
    // Clean up orphaned commas/periods
    result = result.replace(/,\s*\./g, '.');
    result = result.replace(/\.\s*\./g, '.');
    result = result.replace(/\s+([.,;:!?])/g, '$1');
    // Clean up empty lines left by removals
    result = result.replace(/\n{3,}/g, '\n\n');
    // Clean up sentence starting with lowercase after removal
    result = result.replace(/([.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
    // Clean up double spaces again
    result = result.replace(/ {2,}/g, ' ');
  }

  return {
    text: result.trim(),
    patternsFound: detected,
    changeCount,
    originalLength: text.length,
    transformedLength: result.trim().length,
  };
}

function categorizePhrase(phrase: string): string {
  if (['furthermore', 'moreover', 'in addition', 'additionally', 'consequently', 'nevertheless', 'nonetheless', 'accordingly', 'subsequently', 'indeed', 'in essence', 'that said'].includes(phrase)) return 'transition';
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
