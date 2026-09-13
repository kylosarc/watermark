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
 * Returns the corrected text.
 */
export async function harperFixAll(text: string): Promise<string> {
  const linter = await getLinter();
  const lints = await linter.lint(text);

  let result = text;
  // Apply suggestions in reverse order so earlier spans stay valid
  const sorted = [...lints].sort((a, b) => b.span().start - a.span().start);

  for (const lint of sorted) {
    const suggestions = lint.suggestions();
    if (suggestions.length > 0) {
      result = await linter.applySuggestion(result, lint, suggestions[0]);
    }
  }

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
