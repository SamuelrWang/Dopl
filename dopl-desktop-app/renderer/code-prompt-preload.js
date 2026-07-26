// Dedicated preload for the "Sign in to Claude" paste-back window (Feature D).
//
// This window loads a LOCAL file page only (no remote content) and exposes a
// SINGLE narrow IPC channel: the pasted authorization code goes one way,
// renderer -> main. Nothing privileged is exposed. The main window (which hosts
// remote content) keeps its own zero-IPC preload — this surface is isolated to
// the local sign-in page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codePrompt', {
  submit: (code) => ipcRenderer.send('code-prompt:submit', String(code == null ? '' : code)),
});
