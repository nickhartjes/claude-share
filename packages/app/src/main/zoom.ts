import type { MenuItemConstructorOptions } from 'electron';
import type { ZoomDirection } from '../shared/zoom';

// Menu roles would zoom without telling us, so the zoom items call `change` and the main process
// stores and applies the new level (`display-scaling`: Interface zoom, Remembered zoom).

/** The application menu: the platform's usual menus, with zoom items that go through `change`. */
export function menuTemplate(isMac: boolean, change: (direction: ZoomDirection) => void): MenuItemConstructorOptions[] {
  return [
    ...(isMac ? [{ role: 'appMenu' as const }] : [{ role: 'fileMenu' as const }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => change('reset') },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => change('in') },
        // Plus needs Shift on most layouts; also accept the key without it.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => change('in'), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => change('out') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}
