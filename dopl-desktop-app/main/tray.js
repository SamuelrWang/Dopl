// Menu-bar tray for the background role. Template image (macOS recolors it),
// simple menu: Open Dopl / listener status / Quit.

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let currentStatus = 'Listener: starting…';
let handlers = {};
let updateReadyVersion = null;
let windowMode = true; // v1.9: reflect the "Run sessions in a window" setting (default ON)
let pendingCount = 0; // Round B: number of pending consent requests (inbound + review)

function iconPath() {
  // Base 16px + a trayTemplate@2x.png sibling for retina (nativeImage picks up
  // the @2x variant by the filename convention).
  return path.join(__dirname, '..', 'renderer', 'assets', 'trayTemplate.png');
}

// Round C: "Channel folders" submenu — per channel, show its current working
// folder (abbreviated ~/… or the sandbox default) and let the operator choose one
// or revert. The folder is the agent's CONTEXT + default cwd, NOT a sandbox: the
// header spells that out so the operator does not read it as a security boundary.
// The channel list + per-channel labels come from index.js accessors, queried
// fresh on every rebuild so a newly-watched channel / changed folder shows up.
function channelFoldersSubmenu() {
  const list = (handlers.getChannels && handlers.getChannels()) || [];
  const items = [
    { label: "Sets where each channel's agent runs (context, not a sandbox)", enabled: false },
    { type: 'separator' },
  ];
  if (!list.length) {
    items.push({ label: 'No channels watched yet', enabled: false });
    return items;
  }
  for (const ch of list) {
    const label = (handlers.getChannelDirLabel && handlers.getChannelDirLabel(ch.id)) || null;
    items.push({
      label: ch.name || 'Channel',
      submenu: [
        { label: label ? `Folder: ${label}` : 'Folder: Default (sandbox)', enabled: false },
        { type: 'separator' },
        { label: 'Choose folder…', click: () => handlers.onSetChannelDir && handlers.onSetChannelDir(ch.id) },
        {
          label: 'Use default folder',
          enabled: !!label,
          click: () => handlers.onClearChannelDir && handlers.onClearChannelDir(ch.id),
        },
      ],
    });
  }
  return items;
}

// v1.9: the "Sessions" submenu. Its one live control is the executor switch — ON
// (default) opens a native Dopl session window per cross-user run (visible turns,
// in-app Allow/Deny buttons, steering, a cost meter); OFF falls back to today's
// headless spawn + approve-out review. This REPLACES the retired v1.2 "Run responses
// in Terminal" toggle (terminal mode is gone, §G Q2).
function sessionsSubmenu() {
  return [
    {
      label: 'Run sessions in a window',
      type: 'checkbox',
      checked: windowMode,
      click: () => handlers.onToggleWindowMode && handlers.onToggleWindowMode(),
    },
    { type: 'separator' },
    { label: windowMode ? 'On: native session windows' : 'Off: headless fallback', enabled: false },
  ];
}

function buildMenu() {
  const template = [
    { label: 'Open Dopl', click: () => handlers.onOpen && handlers.onOpen() },
  ];
  // Round B: surface pending consent requests and let a click jump straight to the
  // Channels / Pending Requests view (reuses the notification-click open path).
  if (pendingCount > 0) {
    template.push({
      label: `Pending: ${pendingCount} request${pendingCount === 1 ? '' : 's'}`,
      click: () => handlers.onPending && handlers.onPending(),
    });
  }
  template.push(
    { type: 'separator' },
    { label: currentStatus, enabled: false },
    { label: 'Sessions', submenu: sessionsSubmenu() },
    { label: 'Channel folders', submenu: channelFoldersSubmenu() }
  );
  if (updateReadyVersion) {
    template.push({
      label: `Restart to install v${updateReadyVersion}`,
      click: () => handlers.onUpdate && handlers.onUpdate(),
    });
  }
  template.push(
    { type: 'separator' },
    { label: 'Quit Dopl', click: () => handlers.onQuit && handlers.onQuit() }
  );
  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
  tray.setToolTip(currentStatus);
}

function create(opts) {
  handlers = opts || {};
  if (typeof handlers.windowMode === 'boolean') windowMode = handlers.windowMode;
  const img = nativeImage.createFromPath(iconPath());
  if (!img.isEmpty()) img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  if (img.isEmpty()) tray.setTitle('Dopl'); // ensure the tray is visible
  buildMenu();
  return tray;
}

function update(status) {
  if (status) currentStatus = status;
  if (tray) buildMenu();
}

function setUpdateReady(version) {
  updateReadyVersion = version || null;
  if (tray) buildMenu();
}

function setWindowMode(on) {
  windowMode = !!on;
  if (tray) buildMenu();
}

// Round B: update the "Pending: N" tray item. Called from the consent watcher via
// index.js whenever a pending request is created or resolved.
function setPendingCount(n) {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (next === pendingCount) return;
  pendingCount = next;
  if (tray) buildMenu();
}

// Round C: rebuild the menu now (after a channel folder is set / cleared) so the
// "Channel folders" submenu reflects the change without waiting for a status tick.
function refresh() {
  if (tray) buildMenu();
}

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = {
  create, update, setUpdateReady, setWindowMode, setPendingCount, refresh, destroy,
};
