// Minimal, context-isolated preload. The wrapper loads REMOTE content
// (www.usedopl.com), so we expose nothing privileged — only a small read-only
// marker the web app can use to detect it's running in the desktop shell, plus
// an EXTREMELY NARROW, allowlisted channel-folder bridge.
//
// SECURITY — the remote page gets a small, fixed set of operations and nothing
// else. Each is a fixed-name `ipcRenderer.invoke` (no dynamic channel, no event
// emitter, no Node/fs access). The channel-folder ops are bounded to: read the
// ABBREVIATED display label for a channel, TRIGGER the native folder picker
// (which the USER interacts with — the page cannot choose a path itself), and
// reset a channel to the sandbox default. The main handlers return a `~/…`
// label only — never the raw absolute path — so a local filesystem path is
// never handed to the web page or its server. The single `sessions.reopen` op
// only asks the main process to SHOW an existing live session window for a
// (channel, task) the operator owns; it starts no query and returns `{ ok }`
// only. See main/channel-dir-ipc.js.
const { contextBridge, ipcRenderer } = require('electron');

// Coerce whatever the page passes to a string so the main side always validates
// a primitive (it rejects anything that isn't a UUID regardless).
const asId = (channelId) => String(channelId == null ? '' : channelId);

// Same idea for a permission-axis mode: coerce to a primitive string here, and let
// main reject anything that is not one of its frozen enum members. The renderer is
// never the validator.
const asMode = (mode) => String(mode == null ? '' : mode);

contextBridge.exposeInMainWorld('dopl', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Per-channel controls: the working-directory ops (LABEL-ONLY, three of them)
  // plus the two permission-preset ops. Nothing else.
  channels: {
    // → abbreviated label ("~/Downloads/repo") or null (sandbox default).
    getFolderLabel: (channelId) => ipcRenderer.invoke('channels:getFolderLabel', asId(channelId)),
    // Opens the native picker, stores the choice → new label (or the prior label
    // on cancel). Never the absolute path.
    chooseFolder: (channelId) => ipcRenderer.invoke('channels:chooseFolder', asId(channelId)),
    // Resets to the sandbox default → null.
    clearFolder: (channelId) => ipcRenderer.invoke('channels:clearFolder', asId(channelId)),
    // Per-channel PERMISSION PRESET — the two axes the operator picks on the
    // inbound consent card BEFORE Allow, so the session spawns on the posture
    // they approved. Read → { tools, messages } | null (null = nothing stored;
    // the card shows the restrictive defaults). Write → { ok: true } only when
    // BOTH values are known enum members; main re-validates and a bad pair writes
    // nothing. No delete op, and nothing but those two values is ever stored.
    getPermissionPreset: (channelId) =>
      ipcRenderer.invoke('channels:getPermissionPreset', asId(channelId)),
    setPermissionPreset: (channelId, preset) =>
      ipcRenderer.invoke('channels:setPermissionPreset', {
        channelId: asId(channelId),
        preset: {
          tools: asMode(preset && preset.tools),
          messages: asMode(preset && preset.messages),
        },
      }),
  },
  // Reopen (reveal a hidden / front a visible) LIVE session window for a
  // (channel, task) from the MAIN window — the web "Open session" button. One
  // fixed-name invoke; ids coerced to strings (main re-validates). Resolves { ok }
  // — ok:false when no live session exists for that pair (a settled thread's window
  // is destroyed on settle). Wire name `task` == domain name `thread`.
  // v3.0 A5: this OPENS THE WINDOW ONLY. It starts no query and wakes no agent; a
  // parked shell stays parked until a steer or an accepted inbound resumes it.
  sessions: {
    reopen: (channelId, taskId) =>
      ipcRenderer.invoke('sessions:reopen', {
        channelId: asId(channelId),
        taskId: asId(taskId),
      }),
  },
});
