import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, stepZoom, zoomPercent } from '../shared/zoom';
import { menuTemplate } from './zoom';

describe('stepZoom', () => {
  it('zooms in and out in half steps and resets to the default size', () => {
    expect(stepZoom(0, 'in')).toBe(0.5);
    expect(stepZoom(0.5, 'out')).toBe(0);
    expect(stepZoom(2, 'reset')).toBe(0);
  });

  it('shows the level as a percentage', () => {
    expect(zoomPercent(0)).toBe(100);
    expect(zoomPercent(1)).toBe(120);
    expect(zoomPercent(-1)).toBe(83);
  });

  it('stays within the limits', () => {
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
  });
});

describe('menuTemplate', () => {
  const items = (isMac: boolean, change = vi.fn()) => {
    const view = menuTemplate(isMac, change).find((menu) => menu.label === 'View')!;
    return { change, view: view.submenu as MenuItemConstructorOptions[] };
  };

  it.each([
    ['CmdOrCtrl+Plus', 'in'],
    ['CmdOrCtrl+=', 'in'],
    ['CmdOrCtrl+-', 'out'],
    ['CmdOrCtrl+0', 'reset'],
  ])('%s zooms %s through the app, not a menu role', (accelerator, direction) => {
    const { change, view } = items(true);
    const item = view.find((each) => each.accelerator === accelerator)!;
    expect(item.role).toBeUndefined();
    (item.click as () => void)();
    expect(change).toHaveBeenCalledWith(direction);
  });

  it('keeps the edit menu, so copy and paste keep working', () => {
    expect(menuTemplate(true, vi.fn()).map((menu) => menu.role ?? menu.label)).toEqual(['appMenu', 'editMenu', 'View', 'windowMenu']);
    expect(menuTemplate(false, vi.fn()).map((menu) => menu.role ?? menu.label)).toEqual(['fileMenu', 'editMenu', 'View', 'windowMenu']);
  });
});
