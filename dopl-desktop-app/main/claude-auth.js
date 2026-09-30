// THE IN-APP CLAUDE CODE SIGN-INS. Both run the bundled CLI as a child with no window (setup-token under a
// script(1) pseudo-terminal, see below): it opens the OAuth page in the system browser itself and takes the
// redirect on its own localhost listener, so nothing is pasted. Nothing a child prints is logged.
//   `signIn`      `claude setup-token`. The long-lived inference token it prints is stored as Dopl's own
//                 (`claude-token.js`); setup-token only prints it, so the operator's own login is never written.
//   `signInFull`  "Enable Chrome & connectors" (Samuel, 2026-09-25, ruling 4): `claude auth login --claudeai`, a
//                 FULL claude.ai login (user:profile, user:mcp_servers, …) that the CLI keeps in a Dopl-private
//                 secure store — config dir AND secure-store dir both `claude-token.js › fullLoginDir`, so the
//                 Keychain item is `Claude Code-credentials-<sha256(dir)[0:8]>` (or that dir's
//                 `.credentials.json`) and the operator's `~/.claude.json` and Keychain item are never written
//                 (measured, claude 2.1.220). The CLI refreshes it itself; Dopl stores only a marker.
//
// ⚠ setup-token NEEDS A TERMINAL, AND GETS ONE FROM `script(1)` (2026-09-29, measured, claude 2.1.220). With a
// plain pipe for stdout the CLI still opens the browser and still takes the redirect on its localhost listener
// (so the browser says "authenticated"), but it PRINTS NOTHING — not the URL, not the token — until it is
// killed, when it writes one "\n". The flow could only ever end at the 5-minute timeout: "Signing in…"
// endlessly. Under `/usr/bin/script -q /dev/null <claude> setup-token` the same binary draws its screen
// (words spaced by cursor moves, hence the whitespace-blind marker match below) and prints the token.
// The 2026-09-24 pty attempt failed only because stdin was a PIPE (Electron's socketpair: EOPNOTSUPP);
// with stdin `ignore` (/dev/null) script(1) runs, and killing it takes the CLI down with its pty.

const fs = require('fs');
const { spawn } = require('child_process');

const spawner = require('./session-spawner');
const cliSpawn = require('./runtime/cli-spawn');
const { setStoredOAuthToken, fullLoginDir, setFullLogin } = require('./claude-token');
const { SECURE_STORE_ENV } = require('./runtime/claude/credential');
const { diag } = require('./diag');

const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
// What setup-token prints around its token (claude 2.1.220), whitespace removed: under a pty the CLI spaces
// words with cursor moves, not spaces. Both are required, so a token still arriving is never taken.
const TOKEN_OPEN = 'YourOAuthtoken';
const TOKEN_CLOSE = 'Storethistokensecurely';
// The pseudo-terminal wrapper (macOS only — Dopl is macOS only). See the header.
const SCRIPT_BIN = '/usr/bin/script';

const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
const LONE_TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9._-]{20,}$/;

// The token between its two markers, with the terminal's escapes, spacing and line wrapping removed.
function extractToken(s) {
  const plain = String(s).replace(ANSI_RE, '').replace(/\s+/g, '');
  const open = plain.indexOf(TOKEN_OPEN);
  const close = open === -1 ? -1 : plain.indexOf(TOKEN_CLOSE, open);
  if (close === -1) return null;
  const m = plain.slice(open + TOKEN_OPEN.length, close).match(/sk-ant-[A-Za-z0-9._-]{20,}/);
  return m ? m[0] : null;
}

// Without a TTY the CLI may print the token bare. Only trusted once it exited 0, and only if exactly one
// line is a whole token, so a partial or echoed string is never taken.
function extractLoneToken(s) {
  const lines = String(s).replace(ANSI_RE, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => LONE_TOKEN_RE.test(l));
  return lines.length === 1 ? lines[0] : null;
}

/** `auth status --json` says a claude.ai login is in the store it was pointed at. */
function isClaudeAiLogin(out) {
  const plain = String(out).replace(ANSI_RE, '');
  try {
    const s = JSON.parse(plain.slice(plain.indexOf('{'), plain.lastIndexOf('}') + 1));
    return s.loggedIn === true && s.authMethod === 'claude.ai';
  } catch (_) {
    return false;
  }
}

// Every child running now → its stop, so a Cancel can end them (`cancel`).
const stoppers = new Set();

// One CLI child → `{ code, out, picked }`: at its exit, at the timeout or a Cancel (`code: null`), or as soon as
// `pick(out)` answers (the child is then stopped). A failed spawn is `code: null` too. `tty`: run it under
// script(1) so it has a terminal (setup-token prints nothing without one — see the header).
function runChild(bin, args, env, pick, { tty = false } = {}) {
  return new Promise((resolve) => {
    let child;
    const [cmd, argv] = tty && process.platform === 'darwin'
      ? [SCRIPT_BIN, ['-q', '/dev/null', bin, ...args]]
      : [bin, args];
    try {
      child = spawn(cmd, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      diag('claude signin: spawn failed', err && err.message);
      resolve({ code: null, out: '', picked: null });
      return;
    }
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      diag('claude signin: timeout (5m)');
      finish(null, null);
    }, SETUP_TIMEOUT_MS);
    function finish(code, picked) {
      if (settled) return;
      settled = true;
      stoppers.delete(stop);
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_) {}
      resolve({ code, out, picked });
    }
    const onData = (buf) => {
      if (settled) return;
      out += buf.toString('utf8');
      const picked = pick ? pick(out) : null;
      if (picked) finish(null, picked);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      diag('claude signin: child error', err && err.message);
      finish(null, null);
    });
    child.on('close', (code) => finish(code, null));
    const stop = () => {
      diag('claude signin: cancelled');
      finish(null, null);
    };
    stoppers.add(stop);
  });
}

// setup-token → true once Dopl holds the token. The shape of a failed exit (never the text) is logged.
async function runSetupTokenFlow(bin) {
  const env = spawner.cliEnv(bin);
  // A GUI launch has no TERM; the CLI draws for the terminal it is told it has.
  if (!env.TERM || env.TERM === 'dumb') env.TERM = 'xterm-256color';
  const r = await runChild(bin, ['setup-token'], env, extractToken, { tty: true });
  const token = r.picked || (r.code === 0 ? extractLoneToken(r.out) : null);
  if (!token) diag('claude signin: exited', r.code, 'before a token; printed', r.out.length, 'chars');
  const ok = !!token && setStoredOAuthToken(token);
  diag('claude signin:', ok ? 'token stored' : 'failed');
  return ok;
}

// A full-login child's env: no inherited credential, and the CLI's config and secure store both in Dopl's dir.
function fullLoginEnv(bin) {
  const env = cliSpawn.scrubbedEnv(spawner.cliEnv(bin));
  env.CLAUDE_CONFIG_DIR = fullLoginDir();
  env[SECURE_STORE_ENV] = env.CLAUDE_CONFIG_DIR;
  return env;
}

// auth login → true once `auth status` confirms a claude.ai login in Dopl's store and the marker is written.
async function runFullLoginFlow(bin) {
  let env;
  try {
    env = fullLoginEnv(bin);
    fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  } catch (err) {
    diag('claude full login: no private directory', err && err.message);
    return false;
  }
  const login = await runChild(bin, ['auth', 'login', '--claudeai'], env);
  const ok = login.code === 0 && isClaudeAiLogin((await runChild(bin, ['auth', 'status', '--json'], env)).out)
    && setFullLogin(true);
  diag('claude full login:', ok ? 'stored' : `failed (login exit ${login.code})`);
  return ok;
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

// One flow per kind at a time: a click while one runs joins it rather than starting a second.
const running = new Map();
function joined(kind, flow) {
  if (!running.has(kind)) {
    running.set(kind, (async () => {
      const bin = await resolveClaudeBin();
      return { ok: !!bin && await flow(bin) };
    })().finally(() => { running.delete(kind); }));
  }
  return running.get(kind);
}

/** The setup-token sign-in → `{ ok }`. */
const signIn = () => joined('token', runSetupTokenFlow);

/** "Enable Chrome & connectors": the full claude.ai login → `{ ok }`. */
const signInFull = () => joined('full', runFullLoginFlow);

/** Cancel: stop every sign-in child running now, so each flow answers `{ ok: false }` at once. True when one ran. */
function cancel() {
  const running = [...stoppers];
  running.forEach((stop) => stop());
  return running.length > 0;
}

/** Drop the full login: the marker at once (no later spawn uses it), then the CLI's own logout empties the
 *  private store. Fire-and-forget; a failed logout leaves a store nothing reads. */
function signOutFull() {
  setFullLogin(false);
  void resolveClaudeBin().then((bin) => (bin ? runChild(bin, ['auth', 'logout'], fullLoginEnv(bin)) : null))
    .catch((err) => diag('claude full login: logout failed', err && err.message));
}

module.exports = { signIn, signInFull, cancel, signOutFull, extractToken, extractLoneToken, isClaudeAiLogin };
