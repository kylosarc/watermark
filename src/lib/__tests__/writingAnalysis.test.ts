import { describe, expect, it } from 'vitest';
import { analyzeWriting, suggestSynonyms, WRITING_LEXICON_COUNTS } from '../writingAnalysis';

const PROSE = [
  'The city was a jungle. Her eyes widened as she stared at the neon signs.',
  'She walked quickly through the rain, heart pounding. "I can\'t do this," she whispered softly.',
  'At the end of the day, she knew she had to try. The city was a jungle, and she was just another shadow.',
  'I knew the city was watching. She looked at the window. She looked at the door.',
  'The rain fell like a curtain of glass.',
].join(' ');

describe('analyzeWriting', () => {
  it('counts every word and content words separately', () => {
    const result = analyzeWriting(PROSE);
    const city = result.frequencies.find((entry) => entry.word === 'city');
    const contentCity = result.contentFrequencies.find((entry) => entry.word === 'city');
    const the = result.frequencies.find((entry) => entry.word === 'the');

    expect(result.words).toBeGreaterThan(50);
    expect(city?.count).toBe(3);
    expect(contentCity?.count).toBe(3);
    expect(the?.count).toBeGreaterThan(0);
    expect(result.contentFrequencies.some((entry) => entry.word === 'the')).toBe(false);
    expect(result.uniqueWords).toBeGreaterThan(20);
    expect(result.uniqueContentWords).toBeLessThan(result.uniqueWords);
  });

  it('finds nearby word echoes and repeated sentence openers', () => {
    const result = analyzeWriting(PROSE);

    expect(result.echoes.some((echo) => echo.word === 'looked')).toBe(true);
    expect(result.echoes.find((echo) => echo.word === 'looked')?.examples.length).toBeGreaterThan(0);
    expect(result.repeatedOpeners.some((opener) => opener.word === 'she')).toBe(true);
    expect(result.sentenceOpeners.length).toBeGreaterThanOrEqual(5);
  });

  it('detects third-person POV and excludes quoted dialogue by default', () => {
    const result = analyzeWriting(PROSE);

    expect(result.pov.detected).toBe('third');
    expect(result.pov.counts.third).toBeGreaterThan(result.pov.counts.first);
    expect(result.pov.dialogueExcluded).toBe(true);
    expect(result.pov.anomalies.some((anomaly) => anomaly.text.startsWith('I knew'))).toBe(true);
    expect(result.pov.anomalies.some((anomaly) => anomaly.text.includes("can't do this"))).toBe(false);
  });

  it('includes dialogue pronouns when dialogue exclusion is turned off', () => {
    const withDialogue = analyzeWriting(PROSE, { ignoreDialogue: false });
    const withoutDialogue = analyzeWriting(PROSE, { ignoreDialogue: true });

    expect(withDialogue.pov.counts.first).toBe(withoutDialogue.pov.counts.first + 1);
    expect(withDialogue.pov.anomalies.length).toBeGreaterThanOrEqual(withoutDialogue.pov.anomalies.length);
  });

  it('respects an explicitly chosen POV', () => {
    const result = analyzeWriting(PROSE, { pov: 'first' });

    expect(result.pov.choice).toBe('first');
    expect(result.pov.anomalies.length).toBeGreaterThan(0);
    expect(result.pov.anomalies.every((anomaly) => anomaly.expected === 'first')).toBe(true);
    expect(result.pov.anomalies.some((anomaly) => anomaly.found.includes('third'))).toBe(true);
  });

  it('flags clichés, body reactions, filter words and dialogue tag habits', () => {
    const result = analyzeWriting(PROSE);
    const labels = result.tics.map((entry) => entry.label);

    expect(result.cliches.some((entry) => entry.examples.some((example) => example.includes('end of the day')))).toBe(true);
    expect(labels).toContain('Body / reaction clichés');
    expect(labels).toContain('Filter words');
    expect(result.dialogue.saidBookisms.count).toBeGreaterThan(0);
    expect(result.dialogue.adverbTags.count).toBeGreaterThan(0);
    expect(result.dialogue.saidBookisms.examples.some((example) => example.includes('whispered'))).toBe(true);
  });

  it('counts simile and metaphor candidates without claiming understanding', () => {
    const result = analyzeWriting(PROSE);

    expect(result.similes.count).toBeGreaterThan(0);
    expect(result.similes.examples.some((example) => example.includes('like a curtain'))).toBe(true);
    expect(result.metaphors.count).toBeGreaterThan(0);
    expect(result.metaphors.examples.some((example) => example.includes('was a jungle'))).toBe(true);
    expect(result.notes.some((note) => note.includes('not understood figurative meaning'))).toBe(true);
  });

  it('returns readability, rhythm, adverbs and nominalisation metrics', () => {
    const result = analyzeWriting(PROSE);

    expect(Number.isFinite(result.readability.fleschReadingEase)).toBe(true);
    expect(Number.isFinite(result.readability.fleschKincaidGrade)).toBe(true);
    expect(result.rhythm.total).toBeGreaterThan(5);
    expect(result.rhythm.short + result.rhythm.medium + result.rhythm.long + result.rhythm.veryLong).toBe(result.rhythm.total);
    expect(result.adverbs.total).toBeGreaterThanOrEqual(2);
    expect(result.adverbs.top.some((entry) => entry.word === 'quickly' || entry.word === 'softly')).toBe(true);
    expect(result.nominalizations.total).toBeGreaterThanOrEqual(0);
  });

  it('suggests offline alternatives for repeated common words', () => {
    const result = analyzeWriting(PROSE);
    const looked = result.synonyms.find((entry) => entry.word === 'looked');

    expect(looked?.suggestions.length).toBeGreaterThan(0);
    expect(suggestSynonyms('Looked')).toEqual(looked?.suggestions);
    expect(suggestSynonyms('not-in-the-map')).toEqual([]);
    expect(WRITING_LEXICON_COUNTS.synonyms).toBeGreaterThan(50);
  });

  it('handles empty input without throwing', () => {
    const result = analyzeWriting('');

    expect(result.words).toBe(0);
    expect(result.frequencies).toEqual([]);
    expect(result.echoes).toEqual([]);
    expect(result.pov.detected).toBe('none');
    expect(result.readability.fleschReadingEase).toBe(0);
    expect(result.dialogue.dialogueRatio).toBe(0);
  });
});
