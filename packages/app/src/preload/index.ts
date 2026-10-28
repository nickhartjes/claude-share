// Exposes the bridge to the window. Runs sandboxed: only the IPC calls below cross over.
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type Bridge, type HostEvent } from '../shared/bridge';

const send = (message: { type: string } & Record<string, unknown>) => ipcRenderer.send(CHANNELS.hostSend, message);

const bridge: Bridge = {
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  setUsername: (username) => ipcRenderer.invoke(CHANNELS.setUsername, username),
  chooseDirectory: () => ipcRenderer.invoke(CHANNELS.chooseDirectory),
  host: {
    start: (cwd, size) => ipcRenderer.invoke(CHANNELS.hostStart, cwd, size),
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
    export: (id) => ipcRenderer.invoke(CHANNELS.recordingsExport, id),
    open: (id) => ipcRenderer.invoke(CHANNELS.recordingsOpen, id),
    openFile: () => ipcRenderer.invoke(CHANNELS.recordingsOpenFile),
  },
};

contextBridge.exposeInMainWorld('claudeShare', bridge);
