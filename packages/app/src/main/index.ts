import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  deleteRecording,
  exportRecording,
  listRecordings,
  readRecording,
  readRecordingFile,
  RecordingFormatError,
  type Recording,
} from '@claude-share/daemon';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { CHANNELS, type AppSettings, type HostEvent, type OpenRecordingResult } from '../shared/bridge';
import { HostController } from './host-controller';
import { handleWindowOpen, isAppPage } from './navigation';
import { Settings } from './settings';
import { stepZoom, type ZoomDirection } from '../shared/zoom';
import { menuTemplate } from './zoom';

// Lets a second development instance (`just local-dev`) keep its own settings and sessions.
if (process.env['CLAUDE_SHARE_USER_DATA']) app.setPath('userData', process.env['CLAUDE_SHARE_USER_DATA']);
const dataDir = app.getPath('userData');
const sessionsDir = join(dataDir, 'sessions');
const settings = new Settings(join(dataDir, 'settings.json'));
let window: BrowserWindow | undefined;

const host = new HostController({
  sessionsDir,
  stateFile: join(dataDir, 'current-session.json'),
  daemonEntry: join(import.meta.dirname, 'daemon.js'),
  emit: (event: HostEvent) => window?.webContents.send(CHANNELS.hostEvent, event),
  settings: () => settings.get(),
});

/** Recording ids are directory names inside the sessions directory; refuse anything else. */
function recordingDir(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid recording id');
  return join(sessionsDir, id);
}

async function openRecording(read: () => Promise<Recording>): Promise<OpenRecordingResult> {
  try {
    return { ok: true, recording: await read() };
  } catch (error) {
    if (error instanceof RecordingFormatError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Stores a settings change, applies the zoom level and tells every window. */
async function updateSettings(update: unknown): Promise<AppSettings> {
  const updated = await settings.update(update);
  for (const each of BrowserWindow.getAllWindows()) {
    each.webContents.setZoomLevel(updated.zoomLevel);
    each.webContents.send(CHANNELS.settingsChanged, updated);
  }
  return updated;
}

async function zoom(direction: ZoomDirection): Promise<void> {
  await updateSettings({ zoomLevel: stepZoom((await settings.get()).zoomLevel, direction) });
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.getSettings, () => settings.get());
  ipcMain.handle(CHANNELS.setUsername, (_, username: string) => settings.setUsername(username));
  ipcMain.handle(CHANNELS.updateSettings, (_, update: unknown) => updateSettings(update));
  ipcMain.handle(CHANNELS.chooseDirectory, async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Choose the folder to run Claude Code in', properties: ['openDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.hostStart, (_, cwd: string, size: { cols: number; rows: number }) => host.start(cwd, size));
  ipcMain.handle(CHANNELS.hostResume, () => host.resume());
  ipcMain.on(CHANNELS.hostSend, (_, message: { type: string } & Record<string, unknown>) => host.send(message));
  ipcMain.handle(CHANNELS.hostClose, () => host.close());

  ipcMain.handle(CHANNELS.recordingsList, () => listRecordings(sessionsDir));
  ipcMain.handle(CHANNELS.recordingsDelete, (_, id: string) => deleteRecording(recordingDir(id)));
  ipcMain.handle(CHANNELS.recordingsExport, async (_, id: string) => {
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export recording',
      defaultPath: `claude-share-${id}.ccsession`,
      filters: [{ name: 'Claude Share recording', extensions: ['ccsession'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await exportRecording(recordingDir(id), result.filePath);
    return true;
  });
  ipcMain.handle(CHANNELS.recordingsOpen, (_, id: string) => openRecording(() => readRecording(recordingDir(id))));
  ipcMain.handle(CHANNELS.recordingsOpenFile, async (): Promise<OpenRecordingResult> => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Open recording',
      properties: ['openFile'],
      filters: [{ name: 'Claude Share recording', extensions: ['ccsession'] }],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false, cancelled: true };
    return openRecording(() => readRecordingFile(file));
  });
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Share',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // The session lives in the daemon: closing the window only disconnects from it.
  window.on('closed', () => {
    host.detach();
    window = undefined;
  });
  // Links in session content open in the system browser, never in the app (navigation.ts).
  window.webContents.setWindowOpenHandler(({ url }) => handleWindowOpen(url, (external) => void shell.openExternal(external)));
  // electron-vite sets ELECTRON_RENDERER_URL to the dev server in development.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const appUrl = devServerUrl ?? pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href;
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url, appUrl)) event.preventDefault();
  });
  // The saved zoom level, and Ctrl+scroll zooming through the same stored setting as the menu.
  const contents = window.webContents;
  contents.on('did-finish-load', () => void settings.get().then((stored) => contents.setZoomLevel(stored.zoomLevel)));
  contents.on('zoom-changed', (_, direction) => void zoom(direction));
  void window.loadURL(appUrl);
}

void app.whenReady().then(() => {
  registerIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(process.platform === 'darwin', (direction) => void zoom(direction))));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
