// THE ONE ANSWER TO "may the OS opener be pointed at this?" — shared by every main-process
// surface that hands a URL to the user's real browser.
//
// ⚠ WHY THIS MODULE EXISTS AT ALL (#3031, 2026-10-10). Two independent gates were each
// refusing ordinary links, and nothing in the app opened one:
//
//   • `ui-bridge.js` ran a HOST allowlist (`EXTERNAL_HOST_ALLOWLIST = ['stripe.com',
//     'github.com']` plus the app origin). Every other destination answered `{ ok: false }`,
//     which `src/shared/lib/open-external.ts` discards — so a clicked link was a silent
//     no-op. That list was right for the three URLs the app MINTS; it was never a policy for
//     a link a PERSON clicked, and the audit that added it (1beaaf40, 2026-08-03) was closing
//     a different hole.
//   • `spa-window.js` refused the navigation and stopped there: `window.open` denied,
//     `will-navigate` preventDefault'd, with no hand-off. A plain `<a href>` or
//     `<a target="_blank">` never reached the bridge in the first place, so no renderer-side
//     change could have fixed it.
//
// The hardening those two gates were built for is REAL and is kept: `shell.openExternal` is
// the renderer's only outbound primitive and no CSP applies to the OS opener. What changes is
// WHICH axis bounds it. A host allowlist cannot bound a link the user clicked (the whole point
// is that the destination is arbitrary), so the bound is the SCHEME, and the containment that
// actually survives is elsewhere and unchanged:
//   • `file:`, `smb:`, `javascript:`, `vbscript:`, `data:`, `blob:` and every other scheme are
//     refused here — those are local-file, code-execution and credential-leak primitives, not
//     links, and they are the reason this is an allowlist and not a denylist.
//   • an open is VISIBLE: a browser window surfaces. It is a loud channel, not a silent one.
//   • `dopl:avatar` keeps its own HOST allowlist (`avatar-policy.js`) because that one really
//     is a silent main-process GET whose body returns to the renderer. The two are not the
//     same hole and must not be given the same answer.
//
// ⚠ DE-DUPLICATED INTO THE THING THE TESTS SLICE, which is this repo's stated idiom for a
// predicate two modules need (see `ipc-guards.js` and the paragraph in `ui-bridge.js`'s header
// that corrected itself about it). Both `ui-bridge.js` and `spa-window.js` require this, and
// `test/external-url.test.mjs` drives the sentinel block below directly. Do not re-implement
// either function at a call site: a second copy is how the OS opener comes to have two
// policies.

// ─── BEGIN EXTERNAL-URL-PURE (policy; unit-testable via source extraction) ───
//
// The schemes a link may use. `mailto:` is here because a contact link is a link; it opens the
// user's mail client, carries no response back, and is the one non-web scheme the app renders.
const OPENABLE_SCHEMES = Object.freeze(['http:', 'https:', 'mailto:']);

// ⚠ PARSE, NEVER PREFIX-MATCH. The URL constructor strips leading whitespace and C0 controls
// and lower-cases the scheme, so `'  JavaScript:alert(1)'` parses to protocol `javascript:`
// and is refused — a `startsWith('http')` test on the raw string would have admitted
// `'\njavascript:…'` and a `'https:'`-prefixed lookalike alike.
// ⚠ http(s) MUST have a hostname: `http:///etc/passwd` parses with an EMPTY host and a local
// pathname, which is a `file:`-shaped target wearing a web scheme.
function isOpenableExternalUrl(url) {
  if (typeof url !== 'string') return false;
  const raw = url.trim();
  if (!raw) return false;
  let u;
  try {
    u = new URL(raw);
  } catch (_err) {
    return false; // unparseable is refused, never waved through
  }
  if (!OPENABLE_SCHEMES.includes(u.protocol)) return false;
  if (u.protocol === 'mailto:') return true;
  return !!u.hostname;
}

// The HOST alone, for a diagnostic line. ⚠ A refused URL's query string may be whatever the
// caller was trying to smuggle out, so the log gets this and never the URL.
function externalUrlHost(url) {
  try {
    return new URL(String(url).trim()).host || '?';
  } catch (_err) {
    return '?';
  }
}
// ─── END EXTERNAL-URL-PURE ───────────────────────────────────────────────────

module.exports = { OPENABLE_SCHEMES, isOpenableExternalUrl, externalUrlHost };
