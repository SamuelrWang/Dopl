// ATTENDED HANDOFF — "Open in Claude Code" on the desktop consent card (F-118).
//
// WHAT IT IS. When a peer's request raises a consent card on this machine, the operator can
// answer it with THEIR OWN Claude Code instead of letting Dopl spawn a session. This module
// is the whole mechanism: build the prefill prompt, decide how to deliver it, deliver it.
// Receiver-side choice only. No sender flag, no server change, no new message kind.
//
// WHAT IT DELIBERATELY DOES NOT DO, and the dependency list at the top of this file is the
// proof (test/attended-handoff.test.mjs pins it): it never spawns, never posts a lifecycle
// event, never patches the consent row, and never feeds anything to any session. The
// consent row stays PENDING, so Accept remains answerable underneath and behaves exactly as
// it does today. Handing the request to the operator's own client is not a decision ON the
// request; it is the operator taking the work off Dopl's hands.
//
// THE DEEP LINK. `claude-cli://open?cwd=<dir>&q=<prompt>` is documented
// (code.claude.com/docs/en/deep-links) and registered on macOS by "Claude Code URL
// Handler.app". `q` is the URL-encoded prompt (max 5,000 characters) and it arrives in the
// composer UNSUBMITTED, under a "Prompt from an external link" banner: the human presses
// Enter. Every invocation opens a NEW terminal window; there is no IPC into a running REPL,
// and no dedupe. `repo=` also exists and is NOT used: it resolves against the user's
// githubRepoPaths rather than against a path we know.
//
// SECURITY HISTORY, and the rules it leaves behind. This deep link had a real RCE (flag
// smuggling through `q`, fixed in CLI 2.1.118). So: the URL is built with
// encodeURIComponent ONLY, prompt text NEVER touches a shell string anywhere in this app,
// and every interpolated id is narrowed before it can enter either the prompt or the URL
// (attended-prompt.js owns that, and refuses to build a prompt at all when an id does not
// narrow).
//
// THE HANDLER MAY NOT BE INSTALLED. macOS registers it only after the user's first-ever
// interactive `claude` prompt, so a fresh install has no handler and `openExternal` would
// fail silently or hand the URL to something else. Both install locations are probed and a
// miss routes to the clipboard fallback instead.
//
// RESIDUAL (accepted for v1). Nothing on this machine knows that an attended session is now
// working the thread, so the peer's LATER addressed messages still raise their own consent
// cards here. That is a papercut and not a hole: the attended session's own `await` picks
// those messages up regardless of what the operator does with the cards, so dismissing them
// costs nothing. Closing it properly needs a per-thread "attended" marker that the trigger
// path consults, which is state this feature deliberately does not introduce in v1.

const fs = require('fs');
const os = require('os');
const { shell, clipboard, Notification } = require('electron');
const channelDirs = require('./channel-dirs');
const { buildAttendedPrompt } = require('./attended-prompt');
const { diag } = require('./diag');

// ─── BEGIN ATTENDED-HANDOFF-PURE (pure; unit-tested via source extraction) ────
// No electron / fs / os / store refs below, so test/attended-handoff.test.mjs slices this
// block and evaluates it verbatim (the WATCHER-PURE idiom).

const SCHEME = 'claude-cli://open';
// The platform's documented ceiling on `q`. Measured on the ENCODED value, because that is
// what actually travels. Over it the deep link is not attempted at all: a truncated prompt
// would teach a session half a procedure, which is worse than asking for one paste.
const Q_MAX_CHARS = 5000;
const HANDLER_APP = 'Claude Code URL Handler.app';

// Percent-encode one URL component, or null when the input cannot be encoded at all.
// encodeURIComponent THROWS URIError on an unpaired surrogate. The prompt itself can no
// longer carry one (BLOCKER B-1: it is literal text plus narrowed ids, so it is ASCII by
// construction), but the cwd is a path off this disk and this is the belt for both: its null
// is a route to the clipboard rather than an exception thrown out of a button click.
function encodeQ(value) {
  try {
    return encodeURIComponent(String(value == null ? '' : value));
  } catch (_) {
    return null;
  }
}

// The deep link. encodeURIComponent ONLY, on both components. Returns '' when either
// component cannot be encoded, so a caller can never build a half-formed URL.
function handoffUrl(cwd, prompt) {
  const q = encodeQ(prompt);
  const dir = encodeQ(cwd);
  if (q === null || dir === null) return '';
  return `${SCHEME}?cwd=${dir}&q=${q}`;
}

// Where the handler app can live. `~/Applications` first (a per-user registration is what
// the CLI actually creates), then the machine-wide `/Applications`.
function handlerAppPaths(home) {
  const h = String(home == null ? '' : home).replace(/\/+$/, '');
  const out = [];
  if (h) out.push(`${h}/Applications/${HANDLER_APP}`);
  out.push(`/Applications/${HANDLER_APP}`);
  return out;
}

// THE FALLBACK DECISION, and it fails to the clipboard on every uncertainty: no handler
// bundle, an unmeasurable prompt, an over-cap `q`. Only a present handler AND a `q` that
// fits earns the deep link.
function chooseRoute(spec) {
  const s = spec || {};
  if (s.hasHandler !== true) return 'clipboard';
  const n = s.qChars;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > Q_MAX_CHARS) return 'clipboard';
  return 'deep-link';
}

// ─── END ATTENDED-HANDOFF-PURE ───────────────────────────────────────────────

// The clipboard fallback's OS notice. House voice, no em dash.
const COPIED_TITLE = 'Dopl: prompt copied';
const COPIED_BODY = 'Paste it into Claude Code and press Enter.';

function bundleExists(p) {
  try {
    return fs.statSync(p).isDirectory(); // an .app is a directory bundle
  } catch (_) {
    return false;
  }
}

function handlerInstalled() {
  return handlerAppPaths(os.homedir()).some(bundleExists);
}

// The cwd the deep link opens in: the channel's OWN working directory, the same source the
// spawn path uses (session-engine buildSdkOptions reads channelDirs.sessionSpawnDir too),
// so an attended session starts where a Dopl session would have. Always absolute; a
// missing or relative answer degrades to the homedir rather than to a bare `?cwd=`.
// The path is NEVER logged (channel-dirs privacy rule) and never leaves this machine.
function cwdFor(channelId) {
  let dir = '';
  try {
    dir = channelDirs.sessionSpawnDir(channelId) || '';
  } catch (err) {
    diag('attended: channel dir lookup failed', err && err.message);
  }
  return typeof dir === 'string' && dir.startsWith('/') ? dir : os.homedir();
}

// Best effort, like every other notification in this app. Carries no id, no path and no
// message text: the prompt is on the clipboard, not in the banner.
//
// L-4: it takes a CLICK HANDLER, because every other notification here has one (task-notify's
// three notices open the channel; consent's inbound banner calls its injected onOpen) and an
// inert banner reads as a broken one. There is no window to raise from this rung, so the
// click does the one useful thing available: it RE-COPIES the prompt. The banner outlives
// the copy, and a pasteboard that moved on while it was up is the failure the operator can
// actually hit. Guarded like consent's, because a click is not a place to throw.
function notifyCopied(onClick) {
  try {
    if (!Notification || (Notification.isSupported && !Notification.isSupported())) return;
    const n = new Notification({ title: COPIED_TITLE, body: COPIED_BODY });
    n.on('click', () => {
      try {
        if (onClick) onClick();
      } catch (err) {
        diag('attended: notify click failed', err && err.message);
      }
    });
    n.show();
  } catch (err) {
    diag('attended: notify failed', err && err.message);
  }
}

// RUNG 2. The prompt goes to the clipboard and the operator pastes it. This is the whole
// fallback in v1, on purpose.
//
// A THIRD RUNG WE DID NOT BUILD: spawning the operator's terminal directly (osascript, or
// `claude --prefill-b64 <base64>`). It would slot in here, between the deep link and this
// copy, and it is not in v1 for two reasons: `--prefill-b64` is an UNDOCUMENTED flag the
// URL handler happens to use, and driving Terminal from a signed app needs the Apple Events
// entitlement plus the user's TCC grant. Neither is worth it while a paste works.
function copyFallback(prompt) {
  try {
    clipboard.writeText(prompt);
  } catch (err) {
    diag('attended: clipboard write failed', err && err.message);
    return { ok: false, reason: 'clipboard' };
  }
  notifyCopied(() => clipboard.writeText(prompt)); // clicking the banner re-copies it
  return { ok: true, route: 'clipboard' };
}

// THE ENTRY POINT, called by session-ipc with the pre-consent window's own registry entry
// (resolved from event.sender, never from a renderer payload).
//
// FAIL CLOSED FIRST: attended-prompt returns '' when channel / workspace / thread do not
// all narrow, and nothing is opened or copied in that case. The card shows an error note
// and Accept is still there.
async function open(card) {
  const c = card || {};
  // THREE IDS, AND NOTHING ELSE (BLOCKER B-1). The card also holds display strings; none of
  // them are passed, and the template has no parameter left that would take one.
  const prompt = buildAttendedPrompt({
    channelId: c.channelId,
    workspaceId: c.workspaceId,
    threadId: c.taskId, // storage keeps the `task` spelling; this IS the thread id
  });
  if (!prompt) {
    diag('attended: refused, the request ids did not narrow');
    return { ok: false, reason: 'bad-id' };
  }
  const q = encodeQ(prompt);
  const route = chooseRoute({ hasHandler: handlerInstalled(), qChars: q === null ? 0 : q.length });
  const short = String(c.channelId || '').slice(0, 8);
  if (route === 'deep-link') {
    const url = handoffUrl(cwdFor(c.channelId), prompt);
    if (url) {
      try {
        await shell.openExternal(url);
        diag('attended: deep link opened', short, 'q', q.length, 'chars');
        return { ok: true, route: 'deep-link' };
      } catch (err) {
        diag('attended: openExternal failed', err && err.message, '- copying instead');
      }
    }
  }
  diag('attended: clipboard fallback', short, 'q', q === null ? 'unencodable' : `${q.length} chars`);
  return copyFallback(prompt);
}

module.exports = {
  open,
  // pure core (exported for the truth table)
  handoffUrl,
  handlerAppPaths,
  chooseRoute,
  encodeQ,
  SCHEME,
  Q_MAX_CHARS,
  HANDLER_APP,
  COPIED_TITLE,
  COPIED_BODY,
};
