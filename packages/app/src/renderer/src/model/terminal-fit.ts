// A viewer's terminal font size (`display-scaling`: Viewer terminal fits the pane). The host owns
// the number of columns; a viewer can only choose how large each column is drawn.

export const FIT_MIN_FONT = 8;
export const FIT_MAX_FONT = 20;
export const DEFAULT_FONT = 13;

export interface FitInput {
  /** Width available for the terminal's columns, in CSS pixels. */
  paneWidth: number;
  /** The host's terminal width in columns. */
  cols: number;
  /** Width of one cell at `referenceSize`, in CSS pixels. */
  cellWidth: number;
  referenceSize: number;
}

/**
 * The largest font size, in half pixels, at which `cols` columns fit in `paneWidth`; within
 * FIT_MIN_FONT and FIT_MAX_FONT. Below the minimum the terminal scrolls sideways instead.
 */
export function fitFontSize({ paneWidth, cols, cellWidth, referenceSize }: FitInput): number {
  if (paneWidth <= 0 || cols <= 0 || cellWidth <= 0) return DEFAULT_FONT;
  const exact = (referenceSize * paneWidth) / (cols * cellWidth);
  return Math.min(FIT_MAX_FONT, Math.max(FIT_MIN_FONT, Math.floor(exact * 2) / 2));
}
