// Is there a usable vendor binary? The `--version` probe behind `runtime.available()`, with the
// downloaded-build retry and the updater's reject loop (docs/specs/runtime-scaffold.md §3 K10).
// Vendor-neutral: the adapter's `client.js` passes how to resolve its binary, how to read its version,
// and its update source. Moved verbatim from the first adapter's client.js (2026-10-13).
//
// 🔒 AN UPDATE CAN NEVER TURN INTO NO RUNTIME (INVARIANTS §11.0): a downloaded build that fails the probe
// is retried ONCE, longer (its first exec may wait out macOS's first-exec scan), then REJECTED — and the
// answer is what launches run after that (the last good build or the bundle), never "no runtime" on
// account of an update. Each rejection retires one download, so the loop ends at the bundle.

const { execFile } = require('child_process');

// Bounded: `available()` awaits the probe on the spawn path, and a hung binary must read as absent.
const PROBE_TIMEOUT_MS = 5000;

// A downloaded build's first exec may wait out macOS's first-exec scan, so a failed probe on one is
// retried once with this budget before the build is rejected (`../updates/index.js › reject`).
const DOWNLOAD_RETRY_TIMEOUT_MS = 60000;

/**
 * `cfg` — `{ binName, label, resolve, versionGate, onReadable?, updateSource, timeoutMs?, retryTimeoutMs? }`:
 *   `binName`        the name in messages (`<binName> --version`);
 *   `label`          the runtime's display name, in the timeout sentence;
 *   `resolve()`      → `{ ok, path, source, reason }`, called on every probe (an updater switch moves it);
 *   `versionGate(v)` → `{ ok, reason }` — readability only; protocol fit is the shape gate's question;
 *   `onReadable(path, version)` — records a readable answer (the build key);
 *   `updateSource()` → the adapter's update source, for the reject loop.
 * Returns `{ probe(o), probeAt(found, timeoutMs) }`; `o` (`{ timeoutMs, retryTimeoutMs }`) is for tests.
 */
function makeProber(cfg) {
  const bin = cfg.binName;
  const baseTimeoutMs = cfg.timeoutMs || PROBE_TIMEOUT_MS;
  const baseRetryMs = cfg.retryTimeoutMs || DOWNLOAD_RETRY_TIMEOUT_MS;

  /** One `--version` run of the resolved `found` → the probe's answer. Never rejects. */
  function probeAt(found, timeoutMs) {
    return new Promise((resolve) => {
      const finish = (value) => resolve(Object.assign({ path: found.path, source: found.source }, value));
      try {
        execFile(found.path, ['--version'], { timeout: timeoutMs }, (err, stdout) => {
          if (err) {
            finish({
              ok: false,
              reason: err.killed
                ? `\`${found.path}\` did not answer \`${bin} --version\` within ${timeoutMs}ms — Dopl cannot start a ${cfg.label} session on this Mac.`
                : `\`${found.path}\` could not answer \`${bin} --version\`: ${(err && err.message) || err}`,
              version: null,
            });
            return;
          }
          const version = String(stdout || '').trim() || null;
          // Only readability is checked here: whether this build speaks the protocol Dopl reads is the
          // shape gate's question (the adapter's `shape.js` + `../sdk-shape.js`), answered from the
          // build's own schema — never a version range. The answer is recorded for the build key.
          const read = cfg.versionGate(version);
          if (read.ok && typeof cfg.onReadable === 'function') cfg.onReadable(found.path, version);
          finish({ ok: read.ok, reason: read.reason, version });
        });
      } catch (err) {
        finish({ ok: false, reason: `\`${found.path}\` could not be started: ${(err && err.message) || err}`, version: null });
      }
    });
  }

  /**
   * `{ ok, reason, version, path, source }`; `reason` is for the operator.
   * ⚠ A DOWNLOAD THAT FAILS IS RETRIED ONCE, LONGER, THEN REJECTED (see the header).
   */
  async function probe(o) {
    const timeoutMs = (o && o.timeoutMs) || baseTimeoutMs;
    const retryMs = (o && o.retryTimeoutMs) || baseRetryMs;
    // The resolver's reason (missing vs untrusted) is readable; an `execFile` errno is not.
    const found = cfg.resolve();
    if (!found.ok) return { ok: false, reason: found.reason, version: null, path: null, source: null };
    const gate = await probeAt(found, timeoutMs);
    if (gate.ok || found.source !== 'downloaded') return gate;
    const again = await probeAt(found, retryMs);
    if (again.ok) return again;
    // `reject` repoints the updater and its `onSwitch` drops the resolver's cached hit, so the next
    // resolve is a different binary; each rejection retires one download, so this ends at the bundle.
    if (!require('../updates').reject(cfg.updateSource(), found.path)) return again;
    return probe(o);
  }

  return { probe, probeAt };
}

module.exports = { makeProber, PROBE_TIMEOUT_MS, DOWNLOAD_RETRY_TIMEOUT_MS };
