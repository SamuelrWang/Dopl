// Menu-bar tray for the background role. Template image (macOS recolors it),
// simple menu: Open Dopl / listener status / Quit.

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let currentStatus = 'Listener: starting…';
let handlers = {};
let updateReadyVersion = null;

function iconPath() {
  // Base 16px + a trayTemplate@2x.png sibling for retina (nativeImage picks up
  // the @2x variant by the filename convention).
  return path.join(__dirname, '..', 'renderer', 'assets', 'trayTemplate.png');
}

function buildMenu() {
  const template = [
    { label: 'Open Dopl', click: () => handlers.onOpen && handlers.onOpen() },
    { type: 'separator' },
    { label: currentStatus, enabled: false },
  ];
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

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { create, update, setUpdateReady, destroy };
