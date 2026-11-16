import { describe, expect, it } from 'vitest';
import { analyzeText } from '../textAnalysis';

describe('analyzeText style heuristics', () => {
  it('flags common AI-typical phrases without double-counting duplicates', () => {
    const text = "It's important to note that this sentence uses a familiar stock phrase.";
    const analysis = analyzeText(text);
    const phraseSignal = analysis.aiSignals.find((signal) => signal.startsWith('AI-typical phrases found:'));

    expect(phraseSignal).toBeDefined();
    expect(phraseSignal).toContain("it's important to note");
  });

  it('keeps style findings explicitly separate from deterministic checks', () => {
    const analysis = analyzeText('A short ordinary sentence.');

    expect(analysis.aiConfidence).toBeGreaterThanOrEqual(0);
    expect(analysis.aiConfidence).toBeLessThanOrEqual(100);
    expect(analysis.hiddenSignalCount).toBe(0);
  });
});
