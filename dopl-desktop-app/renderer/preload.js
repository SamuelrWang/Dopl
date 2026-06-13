// Minimal, context-isolated preload. The wrapper loads remote content
// (www.usedopl.com), so we expose nothing privileged — only a small read-only
// marker the web app can optionally use to detect it's running in the desktop shell.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dopl', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
