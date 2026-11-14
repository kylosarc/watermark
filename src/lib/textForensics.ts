/**
 * Deterministic Unicode inspection for hidden / invisible / look-alike
 * characters.
 *
 * This is the same kind of check as a "hidden character checker": it enumerates
 * exact code points, counts them, records positions, and reports normalization
 * state. It does not detect statistical text watermarks (Claude / SynthID);
 * those cannot be checked locally.
 */

export type HiddenCategoryId =
  | 'zero-width'
  | 'invisible-format'
  | 'unusual-space'
  | 'bidi-control'
  | 'control-char'
  | 'variation-selector'
  | 'tag-char'
  | 'noncharacter';

export interface HiddenCategoryDef {
  id: HiddenCategoryId;
  label: string;
  description: string;
  cleanup: 'remove' | 'replace-space';
  defaultEnabled: boolean;
  warning?: string;
}

export const HIDDEN_CATEGORY_DEFS: HiddenCategoryDef[] = [
  {
    id: 'zero-width',
    label: 'Zero-width characters',
    description:
      'Non-printing characters such as zero width space, joiners, word joiner, BOM and Hangul fillers. Used for fingerprinting, copy-paste artifacts and occasional tracking.',
    cleanup: 'remove',
    defaultEnabled: true,
  },
  {
    id: 'invisible-format',
    label: 'Invisible formatting',
    description:
      'Soft hyphens, combining grapheme joiners, interlinear annotations, object replacement characters and deprecated format controls.',
    cleanup: 'remove',
    defaultEnabled: true,
  },
  {
    id: 'unusual-space',
    label: 'Look-alike spaces',
    description:
      'Non-breaking, thin, hair, figure, ideographic and other spaces that look like an ordinary space but are different code points. Cleaned to a normal U+0020 space.',
    cleanup: 'replace-space',
    defaultEnabled: true,
  },
  {
    id: 'bidi-control',
    label: 'Directional controls',
    description:
      'Left/right marks and bidirectional embedding, override and isolate controls. Legitimate in RTL text; also used in "Trojan Source" visual spoofing.',
    cleanup: 'remove',
    defaultEnabled: true,
    warning:
      'Removing directional controls can break legitimate right-to-left text. Review the findings before cleaning.',
  },
  {
    id: 'control-char',
    label: 'C0 / C1 controls',
    description:
      'Non-printing control characters other than tab, line feed and carriage return. Often a sign of binary data pasted into a text field.',
    cleanup: 'remove',
    defaultEnabled: true,
  },
  {
    id: 'variation-selector',
    label: 'Variation selectors',
    description:
      'Invisible selectors that choose between glyph variants. Legitimate in emoji and CJK text, but can also carry hidden data.',
    cleanup: 'remove',
    defaultEnabled: false,
    warning:
      'Removing variation selectors can change how emoji and some CJK characters render. Left off by default.',
  },
  {
    id: 'tag-char',
    label: 'Unicode tag characters',
    description:
      'Invisible copies of ASCII in the U+E0000 block. A documented channel for smuggling hidden text and prompt-injection payloads.',
    cleanup: 'remove',
    defaultEnabled: true,
  },
  {
    id: 'noncharacter',
    label: 'Noncharacters',
    description:
      'Code points permanently reserved for internal use (U+FDD0–U+FDEF and the last two code points of every plane). They should not appear in exchanged text.',
    cleanup: 'remove',
    defaultEnabled: true,
  },
];

const CATEGORY_ORDER = new Map<HiddenCategoryId, number>(
  HIDDEN_CATEGORY_DEFS.map((def, index) => [def.id, index]),
);

const ZERO_WIDTH = new Set<number>([
  0x115f, // HANGUL CHOSEONG FILLER
  0x1160, // HANGUL JUNGSEONG FILLER
  0x17b4, // KHMER VOWEL INHERENT AQ
  0x17b5, // KHMER VOWEL INHERENT AA
  0x180e, // MONGOLIAN VOWEL SEPARATOR
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0x3164, // HANGUL FILLER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE / BOM
  0xffa0, // HALFWIDTH HANGUL FILLER
]);

const INVISIBLE_FORMAT = new Set<number>([
  0x00ad, // SOFT HYPHEN
  0x034f, // COMBINING GRAPHEME JOINER
  0x2061, // FUNCTION APPLICATION
  0x2062, // INVISIBLE TIMES
  0x2063, // INVISIBLE SEPARATOR
  0x2064, // INVISIBLE PLUS
  0x206a, // INHIBIT SYMMETRIC SWAPPING
  0x206b, // ACTIVATE SYMMETRIC SWAPPING
  0x206c, // INHIBIT ARABIC FORM SHAPING
  0x206d, // ACTIVATE ARABIC FORM SHAPING
  0x206e, // NATIONAL DIGIT SHAPES
  0x206f, // NOMINAL DIGIT SHAPES
  0x2800, // BRAILLE PATTERN BLANK
  0xfff9, // INTERLINEAR ANNOTATION ANCHOR
  0xfffa, // INTERLINEAR ANNOTATION SEPARATOR
  0xfffb, // INTERLINEAR ANNOTATION TERMINATOR
  0xfffc, // OBJECT REPLACEMENT CHARACTER
]);

const UNUSUAL_SPACES = new Set<number>([
  0x00a0, // NO-BREAK SPACE
  0x1680, // OGHAM SPACE MARK
  0x2000, // EN QUAD
  0x2001, // EM QUAD
  0x2002, // EN SPACE
  0x2003, // EM SPACE
  0x2004, // THREE-PER-EM SPACE
  0x2005, // FOUR-PER-EM SPACE
  0x2006, // SIX-PER-EM SPACE
  0x2007, // FIGURE SPACE
  0x2008, // PUNCTUATION SPACE
  0x2009, // THIN SPACE
  0x200a, // HAIR SPACE
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x202f, // NARROW NO-BREAK SPACE
  0x205f, // MEDIUM MATHEMATICAL SPACE
  0x3000, // IDEOGRAPHIC SPACE
]);

const BIDI_CONTROLS = new Set<number>([
  0x061c, // ARABIC LETTER MARK
  0x200e, // LEFT-TO-RIGHT MARK
  0x200f, // RIGHT-TO-LEFT MARK
  0x202a, // LEFT-TO-RIGHT EMBEDDING
  0x202b, // RIGHT-TO-LEFT EMBEDDING
  0x202c, // POP DIRECTIONAL FORMATTING
  0x202d, // LEFT-TO-RIGHT OVERRIDE
  0x202e, // RIGHT-TO-LEFT OVERRIDE
  0x2066, // LEFT-TO-RIGHT ISOLATE
  0x2067, // RIGHT-TO-LEFT ISOLATE
  0x2068, // FIRST STRONG ISOLATE
  0x2069, // POP DIRECTIONAL ISOLATE
]);

const NAMES: Record<number, string> = {
  0x0000: 'NULL',
  0x0001: 'START OF HEADING',
  0x0002: 'START OF TEXT',
  0x0003: 'END OF TEXT',
  0x0004: 'END OF TRANSMISSION',
  0x0005: 'ENQUIRY',
  0x0006: 'ACKNOWLEDGE',
  0x0007: 'BELL',
  0x0008: 'BACKSPACE',
  0x000b: 'LINE TABULATION',
  0x000c: 'FORM FEED',
  0x000e: 'SHIFT OUT',
  0x000f: 'SHIFT IN',
  0x0010: 'DATA LINK ESCAPE',
  0x0011: 'DEVICE CONTROL ONE',
  0x0012: 'DEVICE CONTROL TWO',
  0x0013: 'DEVICE CONTROL THREE',
  0x0014: 'DEVICE CONTROL FOUR',
  0x0015: 'NEGATIVE ACKNOWLEDGE',
  0x0016: 'SYNCHRONOUS IDLE',
  0x0017: 'END OF TRANSMISSION BLOCK',
  0x0018: 'CANCEL',
  0x0019: 'END OF MEDIUM',
  0x001a: 'SUBSTITUTE',
  0x001b: 'ESCAPE',
  0x001c: 'INFORMATION SEPARATOR FOUR',
  0x001d: 'INFORMATION SEPARATOR THREE',
  0x001e: 'INFORMATION SEPARATOR TWO',
  0x001f: 'INFORMATION SEPARATOR ONE',
  0x007f: 'DELETE',
  0x00a0: 'NO-BREAK SPACE',
  0x00ad: 'SOFT HYPHEN',
  0x034f: 'COMBINING GRAPHEME JOINER',
  0x061c: 'ARABIC LETTER MARK',
  0x115f: 'HANGUL CHOSEONG FILLER',
  0x1160: 'HANGUL JUNGSEONG FILLER',
  0x1680: 'OGHAM SPACE MARK',
  0x17b4: 'KHMER VOWEL INHERENT AQ',
  0x17b5: 'KHMER VOWEL INHERENT AA',
  0x180e: 'MONGOLIAN VOWEL SEPARATOR',
  0x2000: 'EN QUAD',
  0x2001: 'EM QUAD',
  0x2002: 'EN SPACE',
  0x2003: 'EM SPACE',
  0x2004: 'THREE-PER-EM SPACE',
  0x2005: 'FOUR-PER-EM SPACE',
  0x2006: 'SIX-PER-EM SPACE',
  0x2007: 'FIGURE SPACE',
  0x2008: 'PUNCTUATION SPACE',
  0x2009: 'THIN SPACE',
  0x200a: 'HAIR SPACE',
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK',
  0x2028: 'LINE SEPARATOR',
  0x2029: 'PARAGRAPH SEPARATOR',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x202f: 'NARROW NO-BREAK SPACE',
  0x205f: 'MEDIUM MATHEMATICAL SPACE',
  0x2060: 'WORD JOINER',
  0x2061: 'FUNCTION APPLICATION',
  0x2062: 'INVISIBLE TIMES',
  0x2063: 'INVISIBLE SEPARATOR',
  0x2064: 'INVISIBLE PLUS',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
  0x206a: 'INHIBIT SYMMETRIC SWAPPING',
  0x206b: 'ACTIVATE SYMMETRIC SWAPPING',
  0x206c: 'INHIBIT ARABIC FORM SHAPING',
  0x206d: 'ACTIVATE ARABIC FORM SHAPING',
  0x206e: 'NATIONAL DIGIT SHAPES',
  0x206f: 'NOMINAL DIGIT SHAPES',
  0x2800: 'BRAILLE PATTERN BLANK',
  0x3000: 'IDEOGRAPHIC SPACE',
  0x3164: 'HANGUL FILLER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0xffa0: 'HALFWIDTH HANGUL FILLER',
  0xfff9: 'INTERLINEAR ANNOTATION ANCHOR',
  0xfffa: 'INTERLINEAR ANNOTATION SEPARATOR',
  0xfffb: 'INTERLINEAR ANNOTATION TERMINATOR',
  0xfffc: 'OBJECT REPLACEMENT CHARACTER',
  0xe0001: 'LANGUAGE TAG',
};

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(codePoint > 0xffff ? 5 : 4, '0')}`;
}

export function hiddenCategoryLabel(id: HiddenCategoryId): string {
  return HIDDEN_CATEGORY_DEFS.find((def) => def.id === id)?.label ?? id;
}

function unicodeName(codePoint: number): string {
  const known = NAMES[codePoint];
  if (known) return known;

  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) {
    return `VARIATION SELECTOR-${codePoint - 0xfe00 + 1}`;
  }
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) {
    return `VARIATION SELECTOR-${codePoint - 0xe0100 + 17}`;
  }
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) {
    return codePoint === 0xe0001 ? 'LANGUAGE TAG' : 'TAG CHARACTER';
  }
  if (codePoint >= 0x202a && codePoint <= 0x202e) return 'BIDIRECTIONAL CONTROL';
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return 'BIDIRECTIONAL ISOLATE';
  if (codePoint >= 0x0080 && codePoint <= 0x009f) return 'C1 CONTROL';
  if (codePoint >= 0x1d173 && codePoint <= 0x1d17a) return 'MUSICAL SYMBOL FORMAT';
  return 'UNICODE CHARACTER';
}

function isNoncharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xfffe) === 0xfffe
  );
}

function isControl(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return false;
  return (
    (codePoint >= 0x00 && codePoint <= 0x1f) ||
    codePoint === 0x7f ||
    (codePoint >= 0x80 && codePoint <= 0x9f)
  );
}

function isVariationSelector(codePoint: number): boolean {
  return (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function classify(codePoint: number): HiddenCategoryId | null {
  if (ZERO_WIDTH.has(codePoint)) return 'zero-width';
  if (INVISIBLE_FORMAT.has(codePoint)) return 'invisible-format';
  if (UNUSUAL_SPACES.has(codePoint)) return 'unusual-space';
  if (BIDI_CONTROLS.has(codePoint)) return 'bidi-control';
  if (codePoint >= 0x1d173 && codePoint <= 0x1d17a) return 'invisible-format';
  if (isVariationSelector(codePoint)) return 'variation-selector';
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return 'tag-char';
  if (isNoncharacter(codePoint)) return 'noncharacter';
  if (isControl(codePoint)) return 'control-char';
  return null;
}

export function emptyHiddenCategoryCounts(): Record<HiddenCategoryId, number> {
  const counts = {} as Record<HiddenCategoryId, number>;
  for (const def of HIDDEN_CATEGORY_DEFS) counts[def.id] = 0;
  return counts;
}

export function defaultHiddenCleanOptions(): Record<HiddenCategoryId, boolean> {
  const enabled = {} as Record<HiddenCategoryId, boolean>;
  for (const def of HIDDEN_CATEGORY_DEFS) enabled[def.id] = def.defaultEnabled;
  return enabled;
}

export interface HiddenCharOccurrence {
  /** UTF-16 index into the source string. */
  index: number;
  /** 1-based line number. */
  line: number;
  /** 1-based code-point column. */
  column: number;
  /** Short visible context with hidden characters marked. */
  context: string;
}

export interface HiddenCharFinding {
  codePoint: number;
  codePointLabel: string;
  /** Literal character (often invisible). */
  character: string;
  /** Escaped form safe for display, e.g. \\u200B. */
  escaped: string;
  name: string;
  category: HiddenCategoryId;
  count: number;
  occurrences: HiddenCharOccurrence[];
  occurrencesTruncated: boolean;
}

export interface UnicodeNormalizationInfo {
  form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | 'Mixed';
  isNFC: boolean;
  isNFD: boolean;
  isNFKC: boolean;
  isNFKD: boolean;
  combiningMarks: number;
}

export interface HiddenScanResult {
  findings: HiddenCharFinding[];
  totalSignals: number;
  uniqueCodePoints: number;
  byCategory: Record<HiddenCategoryId, number>;
  uniqueByCategory: Record<HiddenCategoryId, number>;
  normalization: UnicodeNormalizationInfo;
  lineCount: number;
  characterCount: number;
  nonAsciiCharacters: number;
}

export interface HiddenCleanResult {
  text: string;
  removed: Record<HiddenCategoryId, number>;
  replaced: Record<HiddenCategoryId, number>;
  totalChanged: number;
  before: HiddenScanResult;
  after: HiddenScanResult;
}

const MAX_OCCURRENCES = 500;
const MAX_CONTEXTS = 3;

function visibleContext(text: string, targetIndex: number, targetWidth: number): string {
  const start = Math.max(0, targetIndex - 28);
  const end = Math.min(text.length, targetIndex + targetWidth + 28);
  let out = '';

  for (let index = start; index < end; ) {
    const codePoint = text.codePointAt(index)!;
    const width = codePoint > 0xffff ? 2 : 1;
    if (index === targetIndex) {
      out += `\u27E6${formatCodePoint(codePoint)}\u27E7`;
    } else if (classify(codePoint)) {
      out += '\u00B7';
    } else {
      const ch = String.fromCodePoint(codePoint);
      out += ch === '\n' || ch === '\r' || ch === '\t' ? ' ' : ch;
    }
    index += width;
  }

  return out.replace(/\s+/g, ' ').trim();
}

function escapedCharacter(codePoint: number): string {
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return `\\u{${codePoint.toString(16).toUpperCase()}}`;
}

function normalizationInfo(text: string): UnicodeNormalizationInfo {
  const nfc = text.normalize('NFC');
  const nfd = text.normalize('NFD');
  const isNFC = text === nfc;
  const isNFD = text === nfd;

  let isNFKC = false;
  let isNFKD = false;
  if (!isNFC && !isNFD) {
    isNFKC = text === text.normalize('NFKC');
    isNFKD = text === text.normalize('NFKD');
  }

  const form = isNFC
    ? 'NFC'
    : isNFD
      ? 'NFD'
      : isNFKC
        ? 'NFKC'
        : isNFKD
          ? 'NFKD'
          : 'Mixed';

  const combiningMarks = (text.match(/\p{M}/gu) ?? []).length;

  return { form, isNFC, isNFD, isNFKC, isNFKD, combiningMarks };
}

/**
 * Scan text for hidden / invisible / look-alike code points.
 *
 * Deterministic: the same text always produces the same result. Positions are
 * UTF-16 offsets; line/column are 1-based. Occurrence lists are capped per code
 * point so a pathological file cannot exhaust memory.
 */
export function scanHiddenCharacters(text: string): HiddenScanResult {
  const byCategory = emptyHiddenCategoryCounts();
  const uniqueByCategory = emptyHiddenCategoryCounts();
  const findingsByCodePoint = new Map<number, HiddenCharFinding>();
  let totalSignals = 0;
  let characterCount = 0;
  let nonAsciiCharacters = 0;
  let line = 1;
  let column = 1;
  let lineCount = text.length === 0 ? 0 : 1;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    const width = codePoint > 0xffff ? 2 : 1;
    const category = classify(codePoint);

    characterCount += 1;
    if (codePoint > 0x7f) nonAsciiCharacters += 1;

    if (category) {
      totalSignals += 1;
      byCategory[category] += 1;
      let finding = findingsByCodePoint.get(codePoint);
      if (!finding) {
        finding = {
          codePoint,
          codePointLabel: formatCodePoint(codePoint),
          character: String.fromCodePoint(codePoint),
          escaped: escapedCharacter(codePoint),
          name: unicodeName(codePoint),
          category,
          count: 0,
          occurrences: [],
          occurrencesTruncated: false,
        };
        findingsByCodePoint.set(codePoint, finding);
        uniqueByCategory[category] += 1;
      }
      finding.count += 1;
      if (finding.occurrences.length < MAX_OCCURRENCES) {
        finding.occurrences.push({
          index,
          line,
          column,
          context:
            finding.occurrences.length < MAX_CONTEXTS
              ? visibleContext(text, index, width)
              : '',
        });
      } else {
        finding.occurrencesTruncated = true;
      }
    }

    if (codePoint === 0x0a) {
      line += 1;
      column = 1;
      lineCount += 1;
    } else {
      column += 1;
    }
    index += width;
  }

  const findings = Array.from(findingsByCodePoint.values());
  findings.sort((a, b) => {
    const categoryDelta =
      (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
    return categoryDelta || b.count - a.count || a.codePoint - b.codePoint;
  });

  return {
    findings,
    totalSignals,
    uniqueCodePoints: findings.length,
    byCategory,
    uniqueByCategory,
    normalization: normalizationInfo(text),
    lineCount,
    characterCount,
    nonAsciiCharacters,
  };
}

/**
 * Remove or replace selected hidden-character categories.
 *
 * Unusual spaces become ordinary U+0020 spaces (line/paragraph separators become
 * newlines). Everything else is removed. The before/after scans make the result
 * inspectable instead of trusting the transformation blindly.
 */
export function cleanHiddenCharacters(
  text: string,
  enabled: Partial<Record<HiddenCategoryId, boolean>> = defaultHiddenCleanOptions(),
): HiddenCleanResult {
  const categories = { ...defaultHiddenCleanOptions(), ...enabled };
  const removed = emptyHiddenCategoryCounts();
  const replaced = emptyHiddenCategoryCounts();
  let output = '';
  let totalChanged = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    const width = codePoint > 0xffff ? 2 : 1;
    const category = classify(codePoint);

    if (category && categories[category]) {
      if (category === 'unusual-space') {
        output += codePoint === 0x2028 || codePoint === 0x2029 ? '\n' : ' ';
        replaced[category] += 1;
      } else {
        removed[category] += 1;
      }
      totalChanged += 1;
    } else {
      output += String.fromCodePoint(codePoint);
    }
    index += width;
  }

  return {
    text: output,
    removed,
    replaced,
    totalChanged,
    before: scanHiddenCharacters(text),
    after: scanHiddenCharacters(output),
  };
}