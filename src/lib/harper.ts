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
 * Apply all first-suggestions from Harper lints to fix grammar/spelling.
 * Rebuilds text from original spans instead of applying suggestions incrementally
 * (which causes span invalidation as text changes).
 */
export async function harperFixAll(text: string): Promise<string> {
  const linter = await getLinter();
  const lints = await linter.lint(text);

  if (lints.length === 0) return text;

  // Sort by start position
  const sorted = [...lints]
    .map((l) => ({ lint: l, span: l.span(), suggestions: l.suggestions() }))
    .filter((item) => item.suggestions.length > 0)
    .sort((a, b) => a.span.start - b.span.start);

  if (sorted.length === 0) return text;

  // Rebuild text by replacing each span with its first suggestion
  let result = '';
  let cursor = 0;

  for (const { span, suggestions } of sorted) {
    // Skip overlapping spans
    if (span.start < cursor) continue;

    // Append text before this span
    result += text.slice(cursor, span.start);
    // Append the suggestion replacement
    result += suggestions[0].get_replacement_text();
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
