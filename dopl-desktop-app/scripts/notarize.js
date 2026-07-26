/**
 * afterSign hook: notarize the signed .app bundle with Apple using notarytool.
 *
 * Credentials (two modes):
 *   1. Keychain profile (preferred, no secrets in env): set DOPL_NOTARY_PROFILE
 *      to a profile created via `xcrun notarytool store-credentials`.
 *   2. Apple ID env vars:
 *        APPLE_ID                     — your Apple ID email
 *        APPLE_APP_SPECIFIC_PASSWORD  — app-specific password
 *
 * Skip notarization in dev with SKIP_NOTARIZE=1 (or =true).
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEAM_ID = '7352NBAF44';

function skipNotarize() {
  const v = String(process.env.SKIP_NOTARIZE || '').toLowerCase();
  return v === '1' || v === 'true';
}

module.exports = async function (context) {
  if (process.platform !== 'darwin') return;

  if (skipNotarize()) {
    console.log('  • Skipping notarization (SKIP_NOTARIZE)');
    return;
  }

  // L6: prefer a keychain profile when DOPL_NOTARY_PROFILE is set (no password on
  // the command line at all); otherwise fall back to Apple ID + app password.
  const profile = process.env.DOPL_NOTARY_PROFILE;
  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;

  let authArgs;
  if (profile) {
    console.log(`  • Auth: notarytool keychain profile '${profile}'`);
    authArgs = ['--keychain-profile', profile];
  } else if (appleId && password) {
    console.log('  • Auth: Apple ID env vars (password not shown)');
    authArgs = ['--apple-id', appleId, '--password', password, '--team-id', TEAM_ID];
  } else {
    console.warn(
      '  • Skipping notarization: set DOPL_NOTARY_PROFILE, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD'
    );
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  // Create a zip for notarization submission.
  const zipPath = path.join(context.appOutDir, 'notarize.zip');
  console.log(`  • Zipping ${appPath} for notarization...`);
  // L6: no shell — args are passed as an array (nothing interpolated into a shell string).
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' });

  console.log('  • Submitting to Apple notarization service...');
  console.log('    This usually takes 5-15 minutes.');

  try {
    const result = execFileSync(
      'xcrun',
      ['notarytool', 'submit', zipPath, ...authArgs, '--wait'],
      { encoding: 'utf-8', timeout: 1200000 }
    );
    console.log(result);

    // Staple the notarization ticket to the app.
    console.log('  • Stapling notarization ticket...');
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
    console.log('  • Notarization complete ✓');
  } catch (err) {
    console.error('  • Notarization failed:', (err && (err.stderr || err.message)) || err);
    // Fetch the submission log for debugging — parse the id from stdout (no shell).
    try {
      const out = String((err && err.stdout) || '');
      const idMatch = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (idMatch) {
        const log = execFileSync(
          'xcrun',
          ['notarytool', 'log', idMatch[0], ...authArgs],
          { encoding: 'utf-8' }
        );
        console.error('  • Notarization log:', log);
      }
    } catch (_) {}
    throw err;
  } finally {
    // Clean up zip.
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }
};
