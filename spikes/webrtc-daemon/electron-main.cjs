// Spike: hidden Electron window that acts as the Chromium (viewer) WebRTC peer.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  win.webContents.on('console-message', (event) => console.log('[renderer]', event.message));
  const turn = JSON.parse(process.env.SPIKE_TURN);
  win.loadFile(path.join(__dirname, 'renderer.html'), {
    query: { mode: process.env.SPIKE_MODE, turn: `turn:${turn.host}:${turn.port}`, user: turn.user, pass: turn.pass },
  });
});
