// Zoom levels for the whole interface (`display-scaling`: Interface zoom), shared by the main process
// (menu, keyboard) and the window (zoom buttons). Electron's level: 0 is the default size, each
// level is 20% larger or smaller.

export type ZoomDirection = 'in' | 'out' | 'reset';

const STEP = 0.5;
export const MIN_ZOOM = -3;
export const MAX_ZOOM = 5;

export function stepZoom(level: number, direction: ZoomDirection): number {
  if (direction === 'reset') return 0;
  const next = level + (direction === 'in' ? STEP : -STEP);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/** The zoom level as a percentage of the default size, as browsers show it. */
export const zoomPercent = (level: number) => Math.round(1.2 ** level * 100);
