// The dopl:// grammar and the web-path → SPA-route map, pure (a truth table in
// test/deep-link-target.test.mjs; `deep-link.js` wires it).
//   dopl://auth#access_token=…        the session handoff
//   dopl://open                       show the app
//   dopl://open/{segment}/{page}      show it AT that page (`?target=<encoded web path>` too)
// Every return is `/` or a path assembled from individually decoded, character-checked segments —
// never a URL, never `//host` or `..`. `null` = not a target; the caller opens the app at home.

const PROTOCOL_PREFIX = 'dopl://';

const VERB_AUTH = 'auth';
const VERB_OPEN = 'open';

const HOME_ROUTE = '/';

const WORKSPACE_HOME_PAGE = 'overview';

// MIRRORS `apps/desktop-ui/src/routes.tsx › WORKSPACE_PAGES` (the suite reads it and fails on drift).
// `true` = the page has a `:param` detail child, the only thing that admits a third segment — which is
// still decoded and SLUG_RE-checked like every other segment.
const WORKSPACE_PAGES = {
  overview: false,
  ontology: true,
  knowledge: true,
  skills: true,
  chats: false,
  channels: true,
  identities: false,
  members: false,
  settings: false,
};

// Mirrors `routes.tsx › RENAMED_PAGES`: an old page name still lands on its new page.
const RENAMED_PAGES = { agents: 'identities' };

const ROOT_ROUTES = new Set(['onboarding', 'home']);

// First segments that are NOT a workspace (marketing/auth, `/canvas`): all land at `/`. Gated against
// `src/config/index.ts › RESERVED_WORKSPACE_SLUGS` by the suite, so a new top-level web route is a
// two-file change.
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
  'link',
  'c',
  'authenticate',
  'signup',
  'get-started',
]);

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isSafeSegment(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}

const MAX_TARGET_CHARS = 512;

const SENTINEL_ORIGIN = 'https://dopl-deep-link.invalid';

/**
 * A web path → validated segments: `[]` = home, `null` = not a path (stop). Query and fragment are
 * dropped, not rejected.
 */
function pathSegments(target) {
  if (target === null || target === undefined) return [];
  if (typeof target !== 'string') return null;
  const raw = target.trim();
  if (raw === '' || raw === '/') return [];
  if (raw.length > MAX_TARGET_CHARS) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw, SENTINEL_ORIGIN);
  } catch (_) {
    return null;
  }
  if (parsed.origin !== SENTINEL_ORIGIN) return null;
  // Walk the RAW path, not `parsed.pathname`: `new URL` normalizes `..` away instead of refusing it.
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
    if (!isSafeSegment(decoded)) return null;
    out.push(decoded);
  }
  return out;
}

/**
 * A web path → the SPA route; `null` only for a MALFORMED target. An unknown page inside a real
 * workspace opens that workspace's home.
 */
function webPathToRoute(target) {
  const segs = pathSegments(target);
  if (segs === null) return null;
  if (segs.length === 0) return HOME_ROUTE;

  const [first, rawPage, detail] = segs;
  const page = Object.prototype.hasOwnProperty.call(RENAMED_PAGES, rawPage) ? RENAMED_PAGES[rawPage] : rawPage;
  if (ROOT_ROUTES.has(first)) return `/${first}`;
  if (WEB_ONLY_ROOTS.has(first)) return HOME_ROUTE;

  const workspaceHome = `/${first}/${WORKSPACE_HOME_PAGE}`;
  if (page === undefined) return workspaceHome;
  if (!Object.prototype.hasOwnProperty.call(WORKSPACE_PAGES, page)) return workspaceHome;
  // A detail segment only where a `:param` route receives it; anything deeper is dropped.
  if (detail !== undefined && WORKSPACE_PAGES[page]) return `/${first}/${page}/${detail}`;
  return `/${first}/${page}`;
}

/**
 * The path of a dopl:// URL AS WRITTEN (query and fragment cut first). `URL.pathname` is already
 * normalized (`..` resolved away), which would disarm `pathSegments`' dot-segment refusal.
 */
function rawPathOf(url) {
  const afterScheme = url.slice(PROTOCOL_PREFIX.length).split('#')[0].split('?')[0];
  const slash = afterScheme.indexOf('/');
  return slash >= 0 ? afterScheme.slice(slash) : '';
}

/**
 * A dopl:// URL → `{ verb, fragment, target }`, or null. Anything that is not `open` is the AUTH
 * handoff (builds in the field send `dopl://auth#…`); `open` must opt in.
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
    // Unparseable here may still carry a real sign-in's tokens after `#`: do not drop it.
    const hash = url.indexOf('#');
    return hash >= 0 ? { verb: VERB_AUTH, fragment: url.slice(hash + 1), target: null } : null;
  }
  if (String(parsed.hostname || '').toLowerCase() === VERB_OPEN) {
    // A non-blank `?target=` wins; otherwise the path is the target.
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
  RENAMED_PAGES,
  ROOT_ROUTES,
  WEB_ONLY_ROOTS,
  MAX_TARGET_CHARS,
  isSafeSegment, // the ONE character rule for a string entering a router path
  parseDeepLink,
  pathSegments,
  webPathToRoute,
};
