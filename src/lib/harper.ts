/**
 * Harper grammar checker integration.
 * Uses harper.js (WASM-based, runs locally/privately).
 * Lazy-loaded — only initializes when first used.
 */

import type { Lint, Suggestion } from 'harper.js';

export interface HarperLint {
  message: string;
  kind: string;
  start: number;
  end: number;
  suggestions: string[];
}

let linterPromise: Promise<{ lint: (text: string) => Promise<Lint[]>; applySuggestion: (text: string, lint: Lint, suggestion: Suggestion) => Promise<string>; dispose: () => Promise<void> }> | null = null;

async function getLinter() {
  if (linterPromise) return linterPromise;

  linterPromise = (async () => {
    const { LocalLinter } = await import('harper.js');
    const { binaryInlined } = await import('harper.js/binaryInlined');
    const linter = new LocalLinter({ binary: binaryInlined });
    await linter.setup();
    return linter;
  })();

  return linterPromise;
}

/**
 * Lint text with Harper and return structured results.
 */
export async function harperLint(text: string): Promise<HarperLint[]> {
  if (typeof text !== 'string' || text.length === 0) return [];
  const linter = await getLinter();
  const lints = await linter.lint(text);

  return lints.map((l) => {
    const span = l.span();
    const suggestions = l.suggestions();
    return {
      message: l.message(),
      kind: l.lint_kind_pretty() ?? l.lint_kind(),
      start: span.start,
      end: span.end,
      suggestions: suggestions.map((s) => s.get_replacement_text()),
    };
  });
}

/**
 * Apply safe suggestions from Harper lints to fix grammar/spelling.
 * Only applies conservative changes — skips suggestions that:
 * - Alter proper nouns or capitalized words
 * - Delete more than 30% of the matched text
 * - Change numbers, citations, or legal references
 * - Are purely stylistic rather than grammatical
 */
export async function harperFixAll(text: string): Promise<string> {
  if (typeof text !== 'string' || text.length === 0) return text;
  const linter = await getLinter();
  const lints = await linter.lint(text);

  if (lints.length === 0) return text;

  // Sort by start position
  const sorted = [...lints]
    .map((l) => ({ lint: l, span: l.span(), suggestions: l.suggestions() }))
    .filter((item) => item.suggestions.length > 0)
    .sort((a, b) => a.span.start - b.span.start);

  if (sorted.length === 0) return text;

  // Rebuild text by replacing only SAFE spans with their first suggestion
  let result = '';
  let cursor = 0;

  for (const { span, suggestions } of sorted) {
    // Skip overlapping spans
    if (span.start < cursor) continue;

    const original = text.slice(span.start, span.end);
    const replacement = suggestions[0].get_replacement_text();

    // Safety checks — skip dangerous suggestions
    const origLen = original.length;
    const replLen = replacement.length;

    // Skip if replacement deletes too much (>30% of original)
    if (replLen < origLen * 0.7 && replLen > 0) {
      result += text.slice(cursor, span.end);
      cursor = span.end;
      continue;
    }

    // Skip if replacement is empty (deletion)
    if (replLen === 0) {
      result += text.slice(cursor, span.end);
      cursor = span.end;
      continue;
    }

    // Skip if original contains a capitalized word (likely proper noun)
    if (/[A-Z][a-z]/.test(original) && !/^[A-Z]\./.test(original)) {
      result += text.slice(cursor, span.end);
      cursor = span.end;
      continue;
    }

    // Skip if original or replacement contains numbers or special citations
    if (/\d/.test(original) || /\d/.test(replacement)) {
      result += text.slice(cursor, span.end);
      cursor = span.end;
      continue;
    }

    // Skip if replacement changes word significantly (different root)
    const origLower = original.toLowerCase().replace(/s$/, '');
    const replLower = replacement.toLowerCase().replace(/s$/, '');
    if (origLower.length > 3 && replLower.length > 3) {
      // Check if they share a common prefix of at least 60% of the shorter word
      const minLen = Math.min(origLower.length, replLower.length);
      const matchLen = Math.min(
        [...origLower].findIndex((c, i) => c !== replLower[i]) === -1 ? minLen : [...origLower].findIndex((c, i) => c !== replLower[i]),
        minLen
      );
      if (matchLen < minLen * 0.6) {
        result += text.slice(cursor, span.end);
        cursor = span.end;
        continue;
      }
    }

    // Skip if replacement removes conjunctions from lists ("X, Y and Z" → "X,  and Z")
    if (/[,]\s*\w+\s+(and|or)\s+\w+/.test(original) && /[,]\s*(and|or)/.test(replacement) && replacement.length < original.length) {
      result += text.slice(cursor, span.end);
      cursor = span.end;
      continue;
    }

    // Apply safe suggestion
    result += text.slice(cursor, span.start);
    result += replacement;
    cursor = span.end;
  }

  // Append remaining text after last span
  result += text.slice(cursor);

  return result;
}

/**
 * Clean up the Harper linter instance.
 */
export async function disposeHarper(): Promise<void> {
  if (linterPromise) {
    const linter = await linterPromise;
    await linter.dispose();
    linterPromise = null;
  }
}
