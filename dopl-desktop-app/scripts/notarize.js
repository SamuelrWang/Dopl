/**
 * afterSign hook: notarize the signed .app bundle with Apple using notarytool.
 *
 * Required environment variables:
 *   APPLE_ID                       — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD    — app-specific password
 *
 * Skip notarization in dev by setting SKIP_NOTARIZE=true
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEAM_ID = '7352NBAF44';

module.exports = async function (context) {
  if (process.platform !== 'darwin') return;

  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('  • Skipping notarization (SKIP_NOTARIZE=true)');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;

  if (!appleId || !password) {
    console.warn('  • Skipping notarization: missing APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD');
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  // Create a zip for notarization submission
  const zipPath = path.join(context.appOutDir, 'notarize.zip');
  console.log(`  • Zipping ${appPath} for notarization...`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

  console.log('  • Submitting to Apple notarization service...');
  console.log('    This usually takes 5-15 minutes.');

  try {
    const result = execSync(
      `xcrun notarytool submit "${zipPath}" ` +
      `--apple-id "${appleId}" ` +
      `--password "${password}" ` +
      `--team-id "${TEAM_ID}" ` +
      `--wait`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 1200000 }
    );
    console.log(result);

    // Staple the notarization ticket to the app
    console.log('  • Stapling notarization ticket...');
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    console.log('  • Notarization complete ✓');
  } catch (err) {
    console.error('  • Notarization failed:', err.stderr || err.message);
    // Log the submission for debugging
    try {
      const log = execSync(
        `xcrun notarytool log --apple-id "${appleId}" --password "${password}" --team-id "${TEAM_ID}" $(echo "${err.stdout}" | grep -o '[0-9a-f-]\\{36\\}' | head -1)`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.error('  • Notarization log:', log);
    } catch (_) {}
    throw err;
  } finally {
    // Clean up zip
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }
};
