// The application menu bar.
//
// SPLIT NOTE (Q4): moved out of index.js, which was AT the 500-line cap when the
// sign-in / sign-out wiring landed. Pure presentation: it takes two accessors
// (go Home, and the live window for Back/Forward) and owns nothing.

const { Menu } = require('electron');

function build({ onHome, getWindow } = {}) {
  const home = typeof onHome === 'function' ? onHome : () => {};
  const win = typeof getWindow === 'function' ? getWindow : () => null;
  // Electron 32+: navigation moved onto webContents.navigationHistory.
  const nav = () => {
    const w = win();
    return w && !w.isDestroyed() ? w.webContents.navigationHistory : null;
  };

  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'Dopl',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => home() },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => { const n = nav(); if (n && n.canGoBack()) n.goBack(); },
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => { const n = nav(); if (n && n.canGoForward()) n.goForward(); },
        },
        { type: 'separator' },
        // ⚠ NO ZOOM ROLES (Samuel, 2026-09-06): the desktop's sizing and spacing are
        // fixed; ⌘+ / ⌘− / ⌘0 must do nothing. The three Electron roles that stood
        // here (`resetZoom`, `zoomIn`, `zoomOut`) were the only thing binding those
        // keys, so removing them removes the capability rather than hiding it.
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { build };
