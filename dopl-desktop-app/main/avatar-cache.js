// Avatar cache — the ONLY new remote-fetch surface (v2.2 Session Window, item 1/5/6).
//
// The session window's CSP is `img-src 'self' data:` (no remote image ever loads),
// so a member's Google avatar URL cannot be rendered directly. Main fetches it once,
// bounds it HARD, and encodes it to a `data:` URI the renderer can set as img.src.
//
// SECURITY (contract §H-3): getDataUri is a ONE-SHOT bounded GET — https-only,
// image/* content-type only, ≤256KB body (declared AND actual), a 4s timeout,
// redirect:'error' (never follow to a non-image host), an assembled-length cap, and
// a positive+negative in-memory cache (a failure is remembered as null so a broken or
// slow avatar never re-fetches in a storm). The URL/token is NEVER logged. It is not
// polling (F-072 intact). The renderer only ever receives a data: URI, never a URL.
//
// listener-io is required LAZILY (only resolveForSession / cachedForUser touch it) so
// this module stays electron-free at load and test/avatar-cache.test.mjs can require
// it in plain Node AND slice its pure guard block (injecting a mock fetch).

// ─── BEGIN AVATAR-CACHE-PURE (pure; unit-tested via source extraction) ─────────
// Node-global-only (fetch, AbortSignal, Buffer, Map) — no host/GUI imports. The test
// slices this block, injects a mock fetch to exercise getDataUri + the cache without a
// network, and runs the guards directly. Self-contained: it declares its OWN constants
// + cache so the sliced block evaluates standalone.

const MAX_BYTES = 256 * 1024; // 256KB raw image cap
const MAX_URI_LEN = 350 * 1024; // assembled data: URI cap (~256KB base64 + header)
const FETCH_TIMEOUT_MS = 4000; // one-shot abort timeout
const MAX_CACHE = 64; // bounded per-URL cache (positive + negative entries)

const cache = new Map(); // url -> dataUri | null (negatives cached to stop re-fetch storms)

// Only an https:// string URL is ever fetched (never http / data / file / blob …).
function isHttpsUrl(url) {
  return typeof url === 'string' && url.startsWith('https://');
}
// SSRF guard: reject a URL whose host is an internal / loopback / link-local
// target so a poisoned avatar_url can never make the desktop blind-GET an
// internal service (e.g. https://169.254.169.254/ metadata, https://10.x,
// https://localhost). Sync + pure (URL is a Node global) so the guard block
// stays testable; it blocks IP-LITERAL and obvious internal hostnames. A public
// hostname that DNS-rebinds to an internal IP is out of scope here (avatar_url
// is not user-settable, redirect:'error' blocks the 302 bypass, and the fetch is
// an image-only, no-exfil GET) — tracked as residual in F-166.
function ipv4Private(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return true; // malformed → block
  return (
    o[0] === 10 || o[0] === 127 || o[0] === 0 ||
    (o[0] === 169 && o[1] === 254) || // link-local incl. cloud metadata
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 100 && o[1] >= 64 && o[1] <= 127) // CGNAT
  );
}
function isSafeAvatarHost(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return false; }
  if (!host) return false;
  const bare = host.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (ipv4Private(bare)) return false;
  // IPv6 loopback / unique-local (fc00::/7) / link-local (fe80::/10) / mapped-v4.
  if (bare === '::1' || bare === '::' || /^f[cd][0-9a-f]{2}:/i.test(bare) ||
      /^fe[89ab][0-9a-f]:/i.test(bare)) return false;
  if (bare.startsWith('::ffff:')) return ipv4Private(bare.slice(7)) ? false : true;
  return true;
}
// The response must declare a raster image content-type (png/jpeg/gif/webp/avif).
// SVG is excluded: it is markup, not raster, and needless to render an avatar.
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
function isImageContentType(ct) {
  if (typeof ct !== 'string') return false;
  return RASTER_TYPES.has(ct.toLowerCase().split(';')[0].trim());
}
// A byte length within the hard cap. NaN / negative / over-cap all FAIL CLOSED.
function sizeWithinLimit(bytes, max) {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= max;
}
// Assemble the data: URI, or null when the content-type is not an image, the base64
// is empty, or the assembled string exceeds the length cap. This is the ONLY
// non-text DOM value the renderer ever sets (img.src), so it must be well-formed.
function assembleDataUri(ct, b64, cap) {
  if (!isImageContentType(ct) || typeof b64 !== 'string' || !b64) return null;
  const uri = `data:${ct};base64,${b64}`;
  return uri.length > cap ? null : uri;
}

// Remember url -> (dataUri | null), evicting the oldest entry over the cap so a
// long-running app can never grow the cache unbounded.
function remember(url, value) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, value);
}

// The bounded fetch+encode. https-only, image/* only, the declared AND actual byte
// cap, a 4s abort, redirect:'error'. Any throw / non-ok / oversize / non-image →
// null. NEVER logs the url or the error (either may embed a signed-URL token).
async function fetchDataUri(url) {
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res || !res.ok) return null;
    const ct = res.headers && res.headers.get ? res.headers.get('content-type') : null;
    if (!isImageContentType(ct)) return null;
    const declared = res.headers && res.headers.get ? Number(res.headers.get('content-length')) : NaN;
    if (Number.isFinite(declared) && !sizeWithinLimit(declared, MAX_BYTES)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!sizeWithinLimit(buf.length, MAX_BYTES)) return null;
    return assembleDataUri(ct.split(';')[0].trim(), buf.toString('base64'), MAX_URI_LEN);
  } catch (_) {
    return null;
  }
}

// Public: resolve a URL to a data: URI, memoized (positive + negative). A non-https
// url short-circuits to null WITHOUT touching the cache.
async function getDataUri(url) {
  if (!isHttpsUrl(url) || !isSafeAvatarHost(url)) return null;
  if (cache.has(url)) return cache.get(url);
  const result = await fetchDataUri(url);
  remember(url, result);
  return result;
}

// Sync warm-cache accessor for the init fast path: the resolved data URI if already
// fetched, else undefined (a not-yet-fetched url is a cache miss).
function cached(url) {
  return cache.get(url);
}
// ─── END AVATAR-CACHE-PURE ─────────────────────────────────────────────────────

// userId -> warm data URI (sync), via the listener's avatar-URL cache. Null when the
// url is unknown or not yet fetched (the async resolveForSession then fills it).
function cachedForUser(userId) {
  const url = avatarUrlFor(userId);
  const hit = url ? cached(url) : undefined;
  return hit || null;
}

// Fire-and-forget: resolve BOTH the operator's and the peer's avatar to data URIs,
// stash them on the session, and emit an `avatars` event so already-rendered bubbles
// repaint (§B.1). NEVER blocks startQuery; a null field means "keep what init set"
// (the renderer OR-merges), and a failure leaves the initials fallback in place.
function resolveForSession(s, ids, emitFn) {
  const selfUrl = avatarUrlFor(ids && ids.selfUserId);
  const peerUrl = avatarUrlFor(ids && ids.peerUserId);
  Promise.all([
    selfUrl ? getDataUri(selfUrl) : Promise.resolve(null),
    peerUrl ? getDataUri(peerUrl) : Promise.resolve(null),
  ]).then(([self, peer]) => {
    if (self) s.selfAvatar = self;
    if (peer) s.peerAvatar = peer;
    try { emitFn({ type: 'avatars', self: s.selfAvatar || null, from: s.peerAvatar || null }); } catch (_) { /* window gone */ }
  }).catch(() => { /* fire-and-forget: never reject into the engine */ });
}

// Lazy so this module stays electron-free at load (listener-io pulls in electron).
function avatarUrlFor(userId) {
  try { return require('./listener-io').avatarUrlFor(userId); } catch (_) { return null; }
}

module.exports = { getDataUri, cached, cachedForUser, resolveForSession };
