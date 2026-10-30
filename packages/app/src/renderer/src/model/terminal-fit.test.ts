import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT, FIT_MAX_FONT, FIT_MIN_FONT, fitFontSize } from './terminal-fit';

// A monospace cell is about 0.6 of the font size: 7.8px at 13px.
const cell = { cellWidth: 7.8, referenceSize: 13 };

describe('fitFontSize', () => {
  it('shrinks the font so a wide host terminal fits every column', () => {
    const size = fitFontSize({ paneWidth: 600, cols: 120, ...cell });
    expect(size).toBe(8);
    expect((size / 13) * 7.8 * 120).toBeLessThanOrEqual(600);
  });

  it('grows the font when the pane gets wider, never past fitting', () => {
    const narrow = fitFontSize({ paneWidth: 700, cols: 80, ...cell });
    const wide = fitFontSize({ paneWidth: 900, cols: 80, ...cell });
    expect(wide).toBeGreaterThan(narrow);
    expect((wide / 13) * 7.8 * 80).toBeLessThanOrEqual(900);
    expect(((wide + 0.5) / 13) * 7.8 * 80).toBeGreaterThan(900);
  });

  it('uses half-pixel steps', () => {
    expect(fitFontSize({ paneWidth: 760, cols: 80, ...cell }) % 0.5).toBe(0);
  });

  it('stays within the minimum and maximum', () => {
    expect(fitFontSize({ paneWidth: 100, cols: 200, ...cell })).toBe(FIT_MIN_FONT);
    expect(fitFontSize({ paneWidth: 3000, cols: 40, ...cell })).toBe(FIT_MAX_FONT);
  });

  it('falls back to the default size before anything is measured', () => {
    expect(fitFontSize({ paneWidth: 0, cols: 80, ...cell })).toBe(DEFAULT_FONT);
    expect(fitFontSize({ paneWidth: 800, cols: 80, cellWidth: 0, referenceSize: 13 })).toBe(DEFAULT_FONT);
  });
});
