// THE IN-APP CLAUDE CODE SIGN-IN. `claude setup-token` runs as a plain child with no window and no TTY: it
// opens the OAuth page in the system browser itself and takes the redirect on its own localhost listener, so
// nothing is pasted. The long-lived token it prints is stored as Dopl's own (`claude-token.js`); setup-token
// only prints it, so the operator's own Claude Code login is never written. The token is never logged.
//
// No pty: macOS `script(1)` needs a terminal on stdin/stdout and refuses the pipes Electron hands a child
// (`tcgetattr/ioctl: Operation not supported on socket`, EOPNOTSUPP, exit 1 in ms).

const { spawn } = require('child_process');

const spawner = require('./session-spawner');
const { setStoredOAuthToken } = require('./claude-token');
const { diag } = require('./diag');

const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
// What setup-token prints around its token (claude 2.1.220). Both are required, so a token still arriving is never taken.
const TOKEN_OPEN = 'Your OAuth token';
const TOKEN_CLOSE = 'Store this token securely';

const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
const LONE_TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9._-]{20,}$/;

// The token between its two markers, with the terminal's escapes and line wrapping removed.
function extractToken(s) {
  const plain = String(s).replace(ANSI_RE, '');
  const open = plain.indexOf(TOKEN_OPEN);
  const close = open === -1 ? -1 : plain.indexOf(TOKEN_CLOSE, open);
  if (close === -1) return null;
  const m = plain.slice(open + TOKEN_OPEN.length, close).replace(/\s+/g, '').match(/sk-ant-[A-Za-z0-9._-]{20,}/);
  return m ? m[0] : null;
}

// Without a TTY the CLI may print the token bare. Only trusted once it exited 0, and only if exactly one
// line is a whole token, so a partial or echoed string is never taken.
function extractLoneToken(s) {
  const lines = String(s).replace(ANSI_RE, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => LONE_TOKEN_RE.test(l));
  return lines.length === 1 ? lines[0] : null;
}

// setup-token → true once Dopl holds the token.
function runSetupTokenFlow(bin) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ['setup-token'], { env: spawner.cliEnv(bin), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      diag('claude signin: spawn failed', err && err.message);
      resolve(false);
      return;
    }

    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      diag('claude signin: timeout (5m)');
      finish(false);
    }, SETUP_TIMEOUT_MS);

    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_) {}
      diag('claude signin:', ok ? 'token stored' : 'failed');
      resolve(ok);
    }

    const onData = (buf) => {
      if (settled) return;
      out += buf.toString('utf8');
      const token = extractToken(out);
      if (token) finish(setStoredOAuthToken(token));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      diag('claude signin: child error', err && err.message);
      finish(false);
    });
    // The shape of a failed exit (never the text) is logged.
    child.on('close', (code) => {
      if (settled) return;
      const token = code === 0 ? extractLoneToken(out) : null;
      if (token) return finish(setStoredOAuthToken(token));
      diag('claude signin: exited', code, 'before a token; printed', out.length, 'chars');
      finish(false);
    });
  });
}

// The BUNDLED binary first (asar-unpacked and signed; most machines never installed a `claude`), then the
// external CLI. The loader pulls `electron.app`, so a throw means "no bundled binary".
async function resolveClaudeBin() {
  try {
    const bundled = require('./runtime/claude/loader').resolveClaudeExecutable();
    if (bundled) return bundled;
  } catch (err) {
    diag('claude signin: bundled binary unresolved', err && err.message);
  }
  try {
    return await spawner.getClaudeBinPath();
  } catch (err) {
    diag('claude signin: external cli unresolved', err && err.message);
    return null;
  }
}

let current = null;

/** One sign-in → `{ ok }`; a click while one runs joins it rather than starting a second. */
function signIn() {
  if (!current) {
    current = (async () => {
      const bin = await resolveClaudeBin();
      if (!bin) return { ok: false };
      return { ok: await runSetupTokenFlow(bin) };
    })().finally(() => { current = null; });
  }
  return current;
}

module.exports = { signIn, extractToken, extractLoneToken };
