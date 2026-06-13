/**
 * afterPack hook: ad-hoc sign the .app bundle so macOS doesn't flag it as "damaged".
 * This removes the quarantine/damaged error. Users will still see an "unidentified developer"
 * warning on first launch, which they can bypass via right-click → Open.
 *
 * For production: replace with a proper Apple Developer ID certificate + notarization.
 */
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function (context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  app=${appPath}`);

  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    console.log('  • ad-hoc signing complete');
  } catch (err) {
    console.warn('  • ad-hoc signing failed (non-fatal):', err.message);
  }
};
