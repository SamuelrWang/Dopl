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
// THE LADDER, top rung first (2026-08-02). 1. THE APP: `claude://code/new` opens the Claude
// Code DESKTOP APP. 2. THE TERMINAL: `claude-cli://open` opens a terminal window. 3. THE
// CLIPBOARD: copy the prompt and say so. Every rung falls to the next one on any uncertainty,
// and the two open rungs carry DIFFERENT prompts (the app's parameter budget is a quarter of
// the terminal's), which is why attended-prompt.js exports two templates.
//
// RUNG 1, THE APP ROUTE, and it is UNDOCUMENTED. `claude://` is registered by
// /Applications/Claude.app (com.anthropic.claudefordesktop; 1.24012.9 is what this was
// verified against on 2026-08-02). `code/new` takes `q` (or `prompt`) and `folder`, routes
// into the ALREADY-RUNNING app instance rather than launching a second one, and leaves the
// prompt in the composer UNSENT for the human to press Enter, exactly like the terminal rung.
// Being undocumented, it can change between app versions with no notice: if it ever stops
// working the failure is a rung that opens nothing, so the bundle probe and the length
// pre-flight below are what keep that from becoming a dead button (openExternal itself cannot
// tell us, same as rung 2).
//
// ITS BOUND IS PER-PARAMETER, AND IT TRUNCATES. `q` and `folder` are each cut at 1,024
// characters. Truncation is the worse of the two failure modes on this file: the terminal
// handler drops an over-long URL entirely (nothing opens, which is at least detectable by the
// operator), while the app happily opens a session holding HALF A PROCEDURE and looking whole.
// So the route is pre-flighted on the encoded length of both parameters and never relies on
// the platform to tell us; over the bound the app rung is skipped and the terminal rung, with
// its full-length prompt, is evaluated instead.
//
// THE DEEP LINK. `claude-cli://open?cwd=<dir>&q=<prompt>` is documented
// (code.claude.com/docs/en/deep-links) and registered on macOS by "Claude Code URL
// Handler.app". `q` is the URL-encoded prompt and it arrives in the composer UNSUBMITTED,
// under a "Prompt from an external link" banner: the human presses Enter. Every invocation
// opens a NEW terminal window; there is no IPC into a running REPL, and no dedupe. `repo=`
// also exists and is NOT used: it resolves against the user's githubRepoPaths rather than
// against a path we know.
//
// ITS LENGTH LIMIT IS NOT THE ONE THE DOCS DESCRIBE, and believing the docs shipped a dead
// button (measured live, 2026-08-02). The documentation caps `q` at 5,000 characters. The
// handler actually drops any URL longer than 4,096 characters TOTAL, scheme and cwd and q
// together: bisected on a real install, 4,096 is delivered and 4,097 is not. The documented
// 5,000 on `q` is therefore unreachable. Worse, the drop is SILENT: openExternal resolves,
// LaunchServices accepts the open, no terminal window appears, and no error reaches this
// process or any log on the machine. There is nothing to detect after the fact, so the
// pre-flight URL_MAX_CHARS check below is the only guard that exists. Routing therefore
// measures the BUILT URL and never the prompt alone, and attended-prompt.js keeps the
// prompt small enough to leave the cwd room inside the budget (a test pins that).
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
const { buildAttendedPrompt, buildAttendedPromptCompact } = require('./attended-prompt');
const { diag } = require('./diag');

// ─── BEGIN ATTENDED-HANDOFF-PURE (pure; unit-tested via source extraction) ────
// No electron / fs / os / store refs below, so test/attended-handoff.test.mjs slices this
// block and evaluates it verbatim (the WATCHER-PURE idiom).

const SCHEME = 'claude-cli://open';
// The handler's REAL ceiling, and it is on the WHOLE URL rather than on `q`: scheme, cwd
// and the encoded prompt all count against it. 4,096 characters are delivered, 4,097 are
// silently discarded, and nothing anywhere reports the loss (see the docblock). Over it the
// deep link is not attempted at all: a truncated prompt would teach a session half a
// procedure, which is worse than asking for one paste.
const URL_MAX_CHARS = 4096;
const HANDLER_APP = 'Claude Code URL Handler.app';

// RUNG 1's scheme, its bundle, and its bound. The cap here is PER PARAMETER and the platform
// TRUNCATES past it rather than refusing, so both `q` and `folder` are measured before
// anything is opened (see the docblock). attended-prompt.js keeps the compact template under
// 1,000 encoded characters, which is the slack this number is chosen to leave.
const APP_SCHEME = 'claude://code/new';
const APP_PARAM_MAX_CHARS = 1024;
const APP_BUNDLE = 'Claude.app';

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

// ...and where Claude.app can live, probed the same way and in the same order. `/Applications`
// is the normal install, `~/Applications` a per-user one; a machine with neither has no app
// route at all and the ladder simply starts at rung 2.
function appBundlePaths(home) {
  const h = String(home == null ? '' : home).replace(/\/+$/, '');
  const out = [];
  if (h) out.push(`${h}/Applications/${APP_BUNDLE}`);
  out.push(`/Applications/${APP_BUNDLE}`);
  return out;
}

// The app link, WITH the two lengths the route decision needs. It answers one object rather
// than a bare string because the bound is on the PARAMETERS and not on the URL: measuring
// them off the finished string later would mean parsing our own query back apart. `url` is ''
// (and both lengths 0) when a component cannot be encoded, so an unencodable prompt fails the
// same `fits` test an over-long one does and there is no second branch to forget.
function appLink(cwd, prompt) {
  const q = encodeQ(prompt);
  const dir = encodeQ(cwd);
  if (q === null || dir === null) return { url: '', appQChars: 0, appFolderChars: 0 };
  return { url: `${APP_SCHEME}?q=${q}&folder=${dir}`, appQChars: q.length, appFolderChars: dir.length };
}

// A length that is measurable, real and inside `cap`. NaN, Infinity, a string, a negative, and
// the 0 that a URL which could not be built reports are all a NO.
function fits(n, cap) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= cap;
}

// THE WHOLE LADDER, as one pure decision, and it steps DOWN on every uncertainty: a missing
// bundle, an unmeasurable length, a URL that could not be built at all (the builders answer
// '' / 0), or one past what the platform will carry.
//
// RUNG 1 is the app, and it needs Claude.app present AND both parameters inside the 1,024 the
// scheme truncates at. RUNG 2 is the terminal handler, unchanged: its cap is on the WHOLE URL
// (scheme, cwd and prompt together) because that is where the handler's real 4,096-character
// ceiling sits, so `urlChars` is the length of the BUILT URL and the caller has to build it
// before it can ask. RUNG 3 is the clipboard, and it is what "no" means everywhere else.
//
// OMITTING the app fields evaluates rung 2 exactly as it did before this rung existed, which
// is also how open() re-asks after an app openExternal rejects.
function chooseRoute(spec) {
  const s = spec || {};
  if (s.hasApp === true && fits(s.appQChars, APP_PARAM_MAX_CHARS) && fits(s.appFolderChars, APP_PARAM_MAX_CHARS)) {
    return 'app';
  }
  if (s.hasHandler !== true) return 'clipboard';
  const n = s.urlChars;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > URL_MAX_CHARS) return 'clipboard';
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

function appInstalled() {
  return appBundlePaths(os.homedir()).some(bundleExists);
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
  // them are passed, and neither template has a parameter left that would take one. One
  // object, both templates: a field that cannot be added here cannot reach either prompt.
  const ids = {
    channelId: c.channelId,
    workspaceId: c.workspaceId,
    threadId: c.taskId, // storage keeps the `task` spelling; this IS the thread id
  };
  const prompt = buildAttendedPrompt(ids); // rungs 2 and 3, the full procedure
  const compact = buildAttendedPromptCompact(ids); // rung 1, inside the app's 1,024
  if (!prompt) {
    diag('attended: refused, the request ids did not narrow');
    return { ok: false, reason: 'bad-id' };
  }
  // BOTH LINKS ARE BUILT BEFORE THE ROUTE IS CHOSEN, because both caps are measured on built
  // output and not on the prompt: rung 2's counts the cwd inside the same 4,096 (a channel
  // with a deep custom directory is exactly the case that overflows), and rung 1's is on the
  // encoded parameters. Both builders answer '' / 0 when a component cannot be encoded, and
  // 0 fails every `fits`, so there is no separate unencodable branch anywhere below.
  const dir = cwdFor(c.channelId);
  const url = handoffUrl(dir, prompt);
  const app = appLink(dir, compact);
  let route = chooseRoute({
    hasApp: appInstalled(), appQChars: app.appQChars, appFolderChars: app.appFolderChars,
    hasHandler: handlerInstalled(), urlChars: url.length,
  });
  const short = String(c.channelId || '').slice(0, 8);
  if (route === 'app') {
    try {
      await shell.openExternal(app.url);
      diag('attended: app opened', short, 'url', app.url.length, 'chars');
      return { ok: true, route: 'app' };
    } catch (err) {
      diag('attended: app openExternal failed', err && err.message, '- stepping down a rung');
      // STEP DOWN, and re-ask WITHOUT the app fields: rung 2 has its own bundle and its own
      // cap, and a rejection here says nothing about either.
      route = chooseRoute({ hasHandler: handlerInstalled(), urlChars: url.length });
    }
  }
  if (route === 'deep-link') {
    try {
      await shell.openExternal(url);
      diag('attended: deep link opened', short, 'url', url.length, 'chars');
      return { ok: true, route: 'deep-link' };
    } catch (err) {
      diag('attended: openExternal failed', err && err.message, '- copying instead');
    }
  }
  diag('attended: clipboard fallback', short, 'url', url ? `${url.length} chars` : 'unencodable');
  return copyFallback(prompt);
}

module.exports = {
  open,
  // pure core (exported for the truth table)
  handoffUrl,
  appLink,
  handlerAppPaths,
  appBundlePaths,
  chooseRoute,
  encodeQ,
  SCHEME,
  APP_SCHEME,
  URL_MAX_CHARS,
  APP_PARAM_MAX_CHARS,
  HANDLER_APP,
  APP_BUNDLE,
  COPIED_TITLE,
  COPIED_BODY,
};
