// THE dopl:// GRAMMAR, AND THE WEB-PATH → SPA-ROUTE MAP, as a truth table.
//
// Pure on purpose — no electron, no window, no I/O — so every case below is a
// table in test/deep-link-target.test.mjs instead of a click test. The wiring
// that consumes it is main/deep-link.js. (The min-version.js / version-gate.js
// split, for the same reason.)
//
// ── THE GRAMMAR ──────────────────────────────────────────────────────────────
//
//   dopl://auth#access_token=…       the session handoff. UNCHANGED, and the
//                                    only verb that existed before this file.
//   dopl://open                      show the app. Nothing else.
//   dopl://open/{segment}/{page}     show the app AT that page.
//   dopl://open?target=%2Fseg%2Fpage the same, for a caller that has a web path
//                                    in hand and would rather encode it whole.
//
// WHY THE `open` VERB EXISTS. The website is being retired
// (docs/migration-research/website-retirement-plan.md §2.5). Until now the
// dopl:// handler adopted auth fragments and nothing else, and a REJECTED
// fragment returned before the window was ever shown — so a plain `dopl://`
// link launched the app on macOS (the OS does that on protocol activation) and
// then sat there doing nothing, which is an accident, not a feature. §2.5 asks
// for the trivial verb that makes it deliberate, and for the optional target
// that lets an old web URL — a bookmark, a link in someone's notes — arrive
// somewhere rather than at a dead page.
//
// ── WHAT MAY COME BACK ───────────────────────────────────────────────────────
//
// A ROUTE, never a URL. Every value this module returns is either `/` or a path
// assembled from segments that were individually decoded and character-checked,
// so no input — hostile, mangled, or merely weird — can make it hand the
// renderer `//evil.example`, `https://…`, `../..`, or anything the SPA's router
// would treat as leaving the app. `null` means "this was not a target"; the
// caller opens the app at home, which is also what an unknown page does. There
// is deliberately no failure mode where a malformed link does nothing at all:
// the person clicked a Dopl link, so the app opens either way.

/** The one thing a caller may not be trusted to have checked. */
const PROTOCOL_PREFIX = 'dopl://';

const VERB_AUTH = 'auth';
const VERB_OPEN = 'open';

/** Where "no idea" lands: the SPA's boot route, which resolves the default workspace. */
const HOME_ROUTE = '/';

/** `WORKSPACE_HOME_PATH` in apps/desktop-ui/src/routes.tsx — the index redirect. */
const WORKSPACE_HOME_PAGE = 'overview';

/**
 * MIRRORS `WORKSPACE_PAGES` in apps/desktop-ui/src/routes.tsx. The value is
 * "this page has a `:param` detail child", which is the only thing that decides
 * whether a third segment is a real route or noise to drop.
 *
 * Main cannot import the SPA's TypeScript, so this is a copy — and a copy of a
 * route table is a drift bomb: a page ported into the SPA that nobody adds here
 * is a page no deep link can ever reach, silently. The test reads routes.tsx and
 * fails when the two disagree.
 *
 * RETIRED (2026-08-07): `canvas`, `canvas2`, `workflows` and `configuration`
 * left this table with their SPA routes (docs/RETIREMENT-UNWIRING-PLAN.md §3.1).
 * An old bookmark naming one is not refused — it is an unknown page inside a
 * real workspace, so it opens that workspace's home page, which is the point.
 */
const WORKSPACE_PAGES = {
  overview: false,
  ontology: true,
  knowledge: true,
  skills: true,
  chats: false,
  channels: false,
  members: false,
  settings: false,
};

/** SPA routes that live OUTSIDE `/:workspaceSegment` (routes.tsx). */
const ROOT_ROUTES = new Set(['onboarding']);

/**
 * Web paths whose FIRST segment is not a workspace: the marketing and auth
 * surface, plus `/canvas` — the web app's workspace-less landing, which
 * resolved the caller's default workspace server-side. The SPA does that at
 * `/` (pages/boot), so all of these arrive there.
 *
 * Listing them matters because the alternative reading is worse: without this,
 * `/login` parses as a workspace named "login" and the app opens on a resolve
 * that cannot succeed.
 */
const WEB_ONLY_ROOTS = new Set([
  'login',
  'pricing',
  'canvas',
  'terms',
  'privacy',
  'join',
  'invite',
  'admin',
  'oauth',
  'auth',
  'api',
  'download',
]);

/**
 * One URL segment. No `/`, no `%`, no `:`, no whitespace, no control bytes —
 * the characters that could turn an interpolated path into something else — and
 * bounded, because it ends up in a router path and in a log line.
 */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Longer than any real app URL; anything past it is not a target. */
const MAX_TARGET_CHARS = 512;

/** A base that no real target can resolve to, so a same-origin check is exact. */
const SENTINEL_ORIGIN = 'https://dopl-deep-link.invalid';

/**
 * Split a web path into validated segments. `[]` is "the path names nothing"
 * (home); `null` is "this is not a path" and is the caller's cue to stop.
 *
 * Query and fragment are DROPPED, not rejected. `?billing=upgrade` is the only
 * one that ever meant anything and the plan retires it, so carrying them would
 * be carrying dead weight into the router — but a bookmark that has one is
 * still a legitimate bookmark, and refusing it would strand exactly the links
 * this verb exists to rescue.
 */
function pathSegments(target) {
  if (target === null || target === undefined) return [];
  if (typeof target !== 'string') return null;
  const raw = target.trim();
  if (raw === '' || raw === '/') return [];
  if (raw.length > MAX_TARGET_CHARS) return null;
  // The safe-redirect rules (src/shared/lib/url/safe-redirect.ts): a single
  // leading slash, never the protocol-relative `//` or the `/\` some parsers
  // mis-read as it, and no control characters anywhere.
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw, SENTINEL_ORIGIN);
  } catch (_) {
    return null;
  }
  // A target that resolved somewhere else was an absolute URL wearing a path.
  if (parsed.origin !== SENTINEL_ORIGIN) return null;
  // WALK THE RAW PATH, NOT `parsed.pathname`. `new URL` NORMALIZES `..` away
  // instead of refusing it, so `/../secrets` arrives as `/secrets` and
  // `/{seg}/../../etc` as `/etc` — a link that says one thing and resolves to
  // another. Nothing can ESCAPE that way (a router path has nowhere to escape
  // to, and the origin check above already ran), but a target carrying dot
  // segments is malformed, and malformed opens the app at home rather than
  // somewhere it was talked into.
  const out = [];
  for (const part of raw.split('#')[0].split('?')[0].split('/')) {
    if (part === '') continue;
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch (_) {
      return null; // a lone `%` — malformed, not merely unknown
    }
    if (decoded === '.' || decoded === '..') return null;
    if (!SLUG_RE.test(decoded)) return null;
    out.push(decoded);
  }
  return out;
}

/**
 * A web app path → the SPA route that shows the same thing.
 *
 * `null` only for a target that is MALFORMED. Everything merely unrecognized
 * resolves as deep as it can and no deeper: an unknown page inside a real
 * workspace opens that workspace's home page rather than the app's, because
 * the workspace half of the link is still good information.
 */
function webPathToRoute(target) {
  const segs = pathSegments(target);
  if (segs === null) return null;
  if (segs.length === 0) return HOME_ROUTE;

  const [first, page, detail] = segs;
  if (ROOT_ROUTES.has(first)) return `/${first}`;
  if (WEB_ONLY_ROOTS.has(first)) return HOME_ROUTE;

  const workspaceHome = `/${first}/${WORKSPACE_HOME_PAGE}`;
  if (page === undefined) return workspaceHome;
  if (!Object.prototype.hasOwnProperty.call(WORKSPACE_PAGES, page)) return workspaceHome;
  // A detail segment is kept only where a `:param` route exists to receive it;
  // anything deeper is dropped, so `/seg/knowledge/kb/entry` opens the kb.
  if (detail !== undefined && WORKSPACE_PAGES[page]) return `/${first}/${page}/${detail}`;
  return `/${first}/${page}`;
}

/**
 * The path of a `dopl://…` URL AS WRITTEN, cut out of the string rather than
 * read off `URL`.
 *
 * `parsed.pathname` is already NORMALIZED: `dopl://open/{seg}/../../etc` comes
 * back as `/etc`, with every dot segment resolved and gone. `pathSegments`
 * refuses dot segments precisely so a link that says one thing cannot resolve
 * to another — and handing it a pre-normalized path silently disarms that,
 * because by then there is nothing left to refuse. (Found by running the
 * dispatcher, not by reading it: the unit case passed, because it was handed
 * the raw string this function now produces.)
 *
 * Query and fragment come off FIRST, so a `?target=/a/b` cannot be mistaken for
 * the start of the path.
 */
function rawPathOf(url) {
  const afterScheme = url.slice(PROTOCOL_PREFIX.length).split('#')[0].split('?')[0];
  const slash = afterScheme.indexOf('/');
  return slash >= 0 ? afterScheme.slice(slash) : '';
}

/**
 * A dopl:// URL → `{ verb, fragment, target }`, or `null` when it is not one.
 *
 * ANYTHING THAT IS NOT `open` IS THE AUTH HANDOFF. That is not laziness: builds
 * already in the field send `dopl://auth#…`, and the URL that a browser
 * assembles is not always the one that was written, so the fallback has to be
 * the verb that was here first. `open` has to opt IN.
 */
function parseDeepLink(url) {
  if (typeof url !== 'string' || !url.startsWith(PROTOCOL_PREFIX)) return null;
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (_) {
    parsed = null;
  }
  if (!parsed) {
    // The pre-existing tolerance, preserved verbatim: a URL this runtime cannot
    // parse may still be carrying tokens after a `#`, and dropping a real
    // sign-in on a parser disagreement is the one failure worth avoiding.
    const hash = url.indexOf('#');
    return hash >= 0 ? { verb: VERB_AUTH, fragment: url.slice(hash + 1), target: null } : null;
  }
  if (String(parsed.hostname || '').toLowerCase() === VERB_OPEN) {
    // `?target=` wins when present and non-blank; otherwise the path IS the
    // target (`dopl://open/seg/page`), and `dopl://open` carries neither.
    const query = parsed.searchParams.get('target');
    const target = query !== null && query.trim() !== '' ? query : rawPathOf(url);
    return { verb: VERB_OPEN, fragment: '', target: target || null };
  }
  return {
    verb: VERB_AUTH,
    fragment: parsed.hash ? parsed.hash.slice(1) : parsed.search.slice(1),
    target: null,
  };
}

module.exports = {
  PROTOCOL_PREFIX,
  VERB_AUTH,
  VERB_OPEN,
  HOME_ROUTE,
  WORKSPACE_HOME_PAGE,
  WORKSPACE_PAGES,
  ROOT_ROUTES,
  WEB_ONLY_ROOTS,
  MAX_TARGET_CHARS,
  parseDeepLink,
  pathSegments,
  webPathToRoute,
};
