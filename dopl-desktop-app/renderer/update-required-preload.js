// Preload for the blocking "update required" screen. The ENTIRE privileged
// surface that page has: read what to draw, press the one button, or quit.
//
// Deliberately three calls and no more. This page is shown to a build the
// server has declared too old, so it gets nothing that could let it pretend
// otherwise: no navigation, no network, no way to dismiss the gate. The verdict
// lives in main (main/version-gate.js) and is only ever RENDERED here.

const { contextBridge, ipcRenderer } = require('electron');

const STATE = 'update-gate:state';

contextBridge.exposeInMainWorld('doplUpdate', {
  // The initial paint. A window created after the verdict settled would
  // otherwise wait for a push that may not come for minutes.
  state: () => ipcRenderer.invoke(STATE),
  // 'restart' | 'check' — main decides what each one means.
  act: (id) => ipcRenderer.invoke('update-gate:act', String(id || '')),
  quit: () => ipcRenderer.invoke('update-gate:quit'),
  // Live narration while an update downloads.
  onState: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on(STATE, (_event, state) => cb(state));
  },
});
