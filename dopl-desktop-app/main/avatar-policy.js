// WHERE the SPA's avatar proxy may point, and what it may hand back.
//
// THE PROBLEM. `profiles.avatar_url` is copied from the OAuth provider's
// `raw_user_meta_data`, so it resolves to `lh3.googleusercontent.com` /
// `avatars.githubusercontent.com` — an open-ended origin set the packaged
// renderer's `img-src 'self' data: blob: <supabase>` (apps/desktop-ui/
// vite.config.ts) rightly refuses, which is why every OAuth avatar in the
// bundled SPA falls back to initials.
//
// THE FIX. Main fetches the image and hands back a `data:` URI, which the CSP
// already allows. The FETCH itself is not new: main/avatar-cache.js has done
// exactly this for the session window since v2.2 (bounded one-shot GET,
// https-only, raster image/* only, ≤256KB, 4s abort, `redirect:'error'`,
// SSRF host guard, positive+negative memoization). This module adds the ONE
// thing the session window never needed — a DESTINATION ALLOWLIST — and
// re-checks the answer at the IPC boundary.
//
// WHY AN ALLOWLIST ON TOP OF avatar-cache's guards. avatar-cache's
// `isSafeAvatarHost` is an SSRF guard: it blocks internal targets and admits
// every public host. That is right for the session window, whose input is a
// workspace member's stored avatar_url. It is NOT right for an IPC handler the
// RENDERER calls with an arbitrary string: a scheme-only gate would make
// `dopl:avatar` the renderer's arbitrary outbound GET — the same hole
// ui-bridge.js's EXTERNAL_HOST_ALLOWLIST exists to close for openExternal, and
// the exfiltration leg out of a `connect-src 'none'` document. So the answer to
// anything not on this list is `null`, and the component keeps its initials.
//
// Adding a provider is a deliberate one-line edit here.

const { SUPABASE_URL } = require('./config');
const avatarCache = require('./avatar-cache');

// ─── BEGIN AVATAR-POLICY-PURE (guards; unit-tested via source extraction) ────
// Node-global-only (URL) — no host/GUI imports, so the test slices this block
// and drives the guards directly.

// The two OAuth providers this app offers (ui-bridge's `begin-sign-in` enum is
// google | github), and nothing else.
const AVATAR_HOST_ALLOWLIST = Object.freeze([
  'lh3.googleusercontent.com',
  'avatars.githubusercontent.com',
]);

// Google load-balances the SAME avatar path across `lh3`…`lh6`, so the stored
// URL's host is not stable across sign-ins. This admits that numbered family
// and NOTHING wider: `*.googleusercontent.com` is Google's general user-content
// host (Drive, Blogger, arbitrary uploads) and would turn a poisoned avatar_url
// into a fetch of attacker-chosen bytes on a Google origin.
const GOOGLE_AVATAR_HOST_RE = /^lh\d+\.googleusercontent\.com$/;

// The assembled `data:` URI may not exceed this. Defense in depth only —
// avatar-cache caps the raw body at 256KB and the assembled URI at 350KB, both
// tighter — but the cap is re-asserted HERE because this is the value that
// crosses IPC into a renderer, and a bound at the boundary must not depend on
// another module keeping its constants small.
const MAX_DATA_URI_LEN = 512 * 1024;

/**
 * TRUE only for an https URL on the avatar allowlist (or on the Supabase
 * storage origin, which serves workspace icons). FAILS CLOSED on anything
 * unparseable, non-https, or credentialed — `https://user:pass@host/` is a
 * credential-smuggling form, never an avatar.
 */
function isAllowedAvatarUrl(url, storageOrigin) {
  if (typeof url !== 'string' || !url) return false;
  let u;
  try {
    u = new URL(url);
  } catch (_err) {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (storageOrigin && u.origin === storageOrigin) return true;
  const host = u.hostname.toLowerCase();
  if (AVATAR_HOST_ALLOWLIST.indexOf(host) !== -1) return true;
  return GOOGLE_AVATAR_HOST_RE.test(host);
}

/**
 * TRUE only for a bounded `data:image/...` URI. The mime is COERCED to image/*
 * here rather than trusted: avatar-cache only ever assembles a raster mime, and
 * this re-check makes that a property of the bridge answer itself, so the only
 * thing the renderer can ever set as `img.src` is an image.
 */
function isBoundedImageDataUri(uri, cap) {
  return (
    typeof uri === 'string' &&
    uri.startsWith('data:image/') &&
    uri.length > 'data:image/'.length &&
    uri.length <= cap
  );
}
// ─── END AVATAR-POLICY-PURE ──────────────────────────────────────────────────

// The Supabase project origin (workspace icons live in a public bucket there).
// Derived from config so a DOPL_SUPABASE_URL override stays consistent.
const AVATAR_STORAGE_ORIGIN = (() => {
  try {
    return new URL(SUPABASE_URL).origin;
  } catch (_err) {
    return '';
  }
})();

/**
 * Resolve an avatar URL to a `data:` URI for the SPA renderer, or null.
 *
 * Null is the ONLY refusal signal — the caller (a component with an initials
 * fallback) treats "no image" identically whether the host was refused, the
 * fetch failed, or the bytes were too big. Nothing about WHY crosses IPC.
 *
 * Caching is avatar-cache's, unchanged: a URL is downloaded at most once per
 * app run (failures memoized as null), so N members sharing an avatar cost one
 * GET and a repeat call costs none.
 */
async function resolveAvatarDataUri(url) {
  if (!isAllowedAvatarUrl(url, AVATAR_STORAGE_ORIGIN)) return null;
  const uri = await avatarCache.getDataUri(url);
  return isBoundedImageDataUri(uri, MAX_DATA_URI_LEN) ? uri : null;
}

module.exports = {
  resolveAvatarDataUri,
  isAllowedAvatarUrl,
  isBoundedImageDataUri,
  AVATAR_HOST_ALLOWLIST,
  AVATAR_STORAGE_ORIGIN,
  MAX_DATA_URI_LEN,
};
