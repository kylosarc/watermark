import { describe, expect, it } from 'vitest';
import { analyzeNgrams } from '../ngrams';

describe('analyzeNgrams', () => {
  it('counts word pairs and keeps sentence boundaries', () => {
    const result = analyzeNgrams('The model was trained. The model was trained.');
    const pairs = new Map(result.wordPairs.map((entry) => [entry.phrase, entry.count]));

    expect(pairs.get('the model')).toBe(2);
    expect(pairs.get('model was')).toBe(2);
    expect(pairs.get('was trained')).toBe(2);
    // "trained the" would only appear if the pair spanned two sentences.
    expect(pairs.has('trained the')).toBe(false);
  });

  it('reports per-level totals for word pairs through 5-grams', () => {
    const result = analyzeNgrams('one two three four five. one two three four five.');
    const pairs = result.levels.find((level) => level.n === 2);
    const trigrams = result.levels.find((level) => level.n === 3);
    const fiveGrams = result.levels.find((level) => level.n === 5);

    expect(pairs?.total).toBe(8);
    expect(trigrams?.total).toBe(6);
    expect(fiveGrams?.total).toBe(2);
    expect(fiveGrams?.unique).toBe(1);
    expect(fiveGrams?.repeated).toBe(1);
  });

  it('finds the longest repeated phrase', () => {
    const result = analyzeNgrams(
      'alpha beta gamma delta epsilon. alpha beta gamma delta epsilon. alpha beta gamma delta epsilon.',
    );

    expect(result.longestRepeatedPhrase?.phrase).toBe('alpha beta gamma delta epsilon');
    expect(result.longestRepeatedPhrase?.count).toBe(3);
  });

  it('returns empty analysis for blank input', () => {
    const result = analyzeNgrams('   \n  ');
    expect(result.tokenCount).toBe(0);
    expect(result.wordPairs).toHaveLength(0);
    expect(result.longestRepeatedPhrase).toBeNull();
  });
});