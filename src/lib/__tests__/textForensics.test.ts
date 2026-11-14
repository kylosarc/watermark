import { describe, expect, it } from 'vitest';
import {
  cleanHiddenCharacters,
  defaultHiddenCleanOptions,
  formatCodePoint,
  scanHiddenCharacters,
} from '../textForensics';

describe('scanHiddenCharacters', () => {
  it('finds zero-width and look-alike space code points with positions', () => {
    const scan = scanHiddenCharacters('a\u200Bb\u00A0c');

    expect(scan.totalSignals).toBe(2);
    expect(scan.byCategory['zero-width']).toBe(1);
    expect(scan.byCategory['unusual-space']).toBe(1);
    expect(scan.characterCount).toBe(5);

    const zeroWidth = scan.findings.find((finding) => finding.codePoint === 0x200b);
    expect(zeroWidth?.codePointLabel).toBe('U+200B');
    expect(zeroWidth?.name).toBe('ZERO WIDTH SPACE');
    expect(zeroWidth?.occurrences[0]).toMatchObject({ index: 1, line: 1, column: 2 });
  });

  it('reports tag characters separately', () => {
    const scan = scanHiddenCharacters(`x${String.fromCodePoint(0xe0041)}y`);
    const tag = scan.findings.find((finding) => finding.category === 'tag-char');

    expect(scan.totalSignals).toBe(1);
    expect(tag?.codePoint).toBe(0xe0041);
    expect(tag?.escaped).toBe('\\u{E0041}');
  });

  it('reports normalization state', () => {
    expect(scanHiddenCharacters('é').normalization.form).toBe('NFC');
    expect(scanHiddenCharacters('e\u0301').normalization.form).toBe('NFD');
  });

  it('formats code points consistently', () => {
    expect(formatCodePoint(0x0a)).toBe('U+000A');
    expect(formatCodePoint(0xe0041)).toBe('U+E0041');
  });
});

describe('cleanHiddenCharacters', () => {
  it('removes zero-width characters and replaces unusual spaces', () => {
    const result = cleanHiddenCharacters('a\u200Bb\u00A0c');

    expect(result.text).toBe('ab c');
    expect(result.removed['zero-width']).toBe(1);
    expect(result.replaced['unusual-space']).toBe(1);
    expect(result.before.totalSignals).toBe(2);
    expect(result.after.totalSignals).toBe(0);
  });

  it('respects disabled categories', () => {
    const options = { ...defaultHiddenCleanOptions(), 'zero-width': false };
    const result = cleanHiddenCharacters('a\u200Bb', options);

    expect(result.text).toBe('a\u200Bb');
    expect(result.totalChanged).toBe(0);
  });

  it('keeps variation selectors by default', () => {
    const options = defaultHiddenCleanOptions();
    const result = cleanHiddenCharacters(`a\uFE0Fb`, options);

    expect(options['variation-selector']).toBe(false);
    expect(result.text).toBe('a\uFE0Fb');
  });
});