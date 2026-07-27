// Minimal, context-isolated preload. The wrapper loads REMOTE content
// (www.usedopl.com), so we expose nothing privileged — only a small read-only
// marker the web app can use to detect it's running in the desktop shell, plus
// an EXTREMELY NARROW, allowlisted channel-folder bridge.
//
// SECURITY — the remote page gets exactly three folder operations and nothing
// else. Each is a fixed-name `ipcRenderer.invoke` (no dynamic channel, no event
// emitter, no Node/fs access). What the page can do is bounded to: read the
// ABBREVIATED display label for a channel, TRIGGER the native folder picker
// (which the USER interacts with — the page cannot choose a path itself), and
// reset a channel to the sandbox default. The main handlers return a `~/…`
// label only — never the raw absolute path — so a local filesystem path is
// never handed to the web page or its server. See main/channel-dir-ipc.js.
const { contextBridge, ipcRenderer } = require('electron');

// Coerce whatever the page passes to a string so the main side always validates
// a primitive (it rejects anything that isn't a UUID regardless).
const asId = (channelId) => String(channelId == null ? '' : channelId);

contextBridge.exposeInMainWorld('dopl', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Per-channel working-directory controls. LABEL-ONLY, three ops, nothing else.
  channels: {
    // → abbreviated label ("~/Downloads/repo") or null (sandbox default).
    getFolderLabel: (channelId) => ipcRenderer.invoke('channels:getFolderLabel', asId(channelId)),
    // Opens the native picker, stores the choice → new label (or the prior label
    // on cancel). Never the absolute path.
    chooseFolder: (channelId) => ipcRenderer.invoke('channels:chooseFolder', asId(channelId)),
    // Resets to the sandbox default → null.
    clearFolder: (channelId) => ipcRenderer.invoke('channels:clearFolder', asId(channelId)),
  },
});
