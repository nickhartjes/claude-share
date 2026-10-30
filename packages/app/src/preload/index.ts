// Exposes the bridge to the window. Runs sandboxed: only the IPC calls below cross over.
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type AppSettings, type Bridge, type HostEvent, type UpdateStatus } from '../shared/bridge';

const send = (message: { type: string } & Record<string, unknown>) => ipcRenderer.send(CHANNELS.hostSend, message);

const bridge: Bridge = {
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  setUsername: (username) => ipcRenderer.invoke(CHANNELS.setUsername, username),
  updateSettings: (update) => ipcRenderer.invoke(CHANNELS.updateSettings, update),
  onSettingsChanged: (listener) => {
    const handler = (_: unknown, settings: AppSettings) => listener(settings);
    ipcRenderer.on(CHANNELS.settingsChanged, handler);
    return () => ipcRenderer.off(CHANNELS.settingsChanged, handler);
  },
  chooseDirectory: () => ipcRenderer.invoke(CHANNELS.chooseDirectory),
  forgetFolder: (folder) => ipcRenderer.invoke(CHANNELS.forgetFolder, folder),
  host: {
    start: (cwd, size) => ipcRenderer.invoke(CHANNELS.hostStart, cwd, size),
    startRecent: (cwd, size) => ipcRenderer.invoke(CHANNELS.hostStartRecent, cwd, size),
    resume: () => ipcRenderer.invoke(CHANNELS.hostResume),
    onEvent: (listener) => {
      const handler = (_: unknown, event: HostEvent) => listener(event);
      ipcRenderer.on(CHANNELS.hostEvent, handler);
      return () => ipcRenderer.off(CHANNELS.hostEvent, handler);
    },
    input: (data) => send({ type: 'input', data }),
    resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    revokeCode: () => send({ type: 'revoke-code' }),
    removeViewer: (viewerId) => send({ type: 'remove-viewer', viewerId }),
    setViewerLimit: (limit) => send({ type: 'set-viewer-limit', limit }),
    close: () => ipcRenderer.invoke(CHANNELS.hostClose),
  },
  recordings: {
    list: () => ipcRenderer.invoke(CHANNELS.recordingsList),
    delete: (id) => ipcRenderer.invoke(CHANNELS.recordingsDelete, id),
    rename: (id, title) => ipcRenderer.invoke(CHANNELS.recordingsRename, id, title),
    export: (id) => ipcRenderer.invoke(CHANNELS.recordingsExport, id),
    open: (id) => ipcRenderer.invoke(CHANNELS.recordingsOpen, id),
    openFile: () => ipcRenderer.invoke(CHANNELS.recordingsOpenFile),
  },
  updates: {
    get: () => ipcRenderer.invoke(CHANNELS.updatesGet),
    onChanged: (listener) => {
      const handler = (_: unknown, status: UpdateStatus) => listener(status);
      ipcRenderer.on(CHANNELS.updatesChanged, handler);
      return () => ipcRenderer.off(CHANNELS.updatesChanged, handler);
    },
    check: () => ipcRenderer.invoke(CHANNELS.updatesCheck),
    restart: () => ipcRenderer.invoke(CHANNELS.updatesRestart),
    openDownload: () => ipcRenderer.invoke(CHANNELS.updatesOpenDownload),
  },
};

contextBridge.exposeInMainWorld('specDeck', bridge);
