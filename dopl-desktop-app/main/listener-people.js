// Channels listener — WHO THE PEOPLE ARE (operator identity + the peer name/avatar cache).
//
// SPLIT NOTE (§2, 2026-09-22): extracted from listener-io.js, which stood at 532 of the
// 500-line `max-lines` cap `npm run lint` (the CI `desktop` job) enforces with zero
// exemptions. Split on the seam INVARIANTS §1 names — one file per reason to change —
// rather than at the line the cap fell on. listener-io.js is the listener's PLUMBING: the
// cursor/seed stores, the credentialed send and its 401 repair, the workspace/channel
// enumeration and its retry ladder. This file answers the one question that is not about
// plumbing but about PEOPLE — who is this operator (so a channel loop never self-triggers),
// and what do we call the peer a notification is about.
//
// ⚠ THE TWO HALVES ARE ONE REASON TO CHANGE, which is why they ship in one file: both are
// read off the SAME surface — `/api/workspaces/{slug}-{publicId}/members`, with
// `/api/workspaces/me` as identity's last-resort tier — and both change when that DTO's
// shape changes (the missing-publicId guard below is exactly such a change, and it landed
// on this pair alone). Nothing here decides anything about the transport, and nothing in
// the transport decides anything about names.
//
// ⚠ NO CALLER MOVED. listener-io.js re-exports `resolveIdentity`, `displayNameFor`,
// `avatarUrlFor` and `refreshNameCache` as the VERY function objects declared below — not
// re-spellings (the pin test/module-split-identity.test.mjs exists for) — so
// `io.displayNameFor(...)` in trigger.js / task-notify.js / room-roster.js /
// version-skew.js / session-dispatch.js, `io.refreshNameCache(ws)` and
// `io.resolveIdentity(firstWs)` in channel-listener.js, and avatar-cache.js's
// `require('./listener-io').avatarUrlFor(...)` are all untouched. One module means one
// instance of the two caches, which is the property a copy would silently break.
//
// ⚠ THE TRANSPORT IS REACHED LAZILY, PER CALL, AND THAT IS DELIBERATE. listener-io.js
// requires THIS file, so a top-level `const { apiFetch } = require('./listener-io')` here
// would bind whatever that module's `exports` held mid-build — `undefined` — and the first
// members read would throw. Resolving inside the call happens after both module bodies have
// run; `avatar-cache.js` and `room-roster.js` already reach back into listener-io exactly
// this way. Keeping the call sites BARE (`apiFetch(...)`, never `io.apiFetch(...)`) is also
// what lets test/namecache-segment-guard.test.mjs slice `refreshNameCache` out of this
// source and drive it with a fake fetch injected as a free variable.

const auth = require('./auth');
const { diag } = require('./diag');

const apiFetch = (pathname, opts) => require('./listener-io').apiFetch(pathname, opts);
const normalizeList = (data, key) => require('./listener-io').normalizeList(data, key);

const nameCache = new Map(); // userId -> displayName, refreshed once per reconcile
const avatarUrlCache = new Map(); // userId -> avatarUrl (item 1/5/6), refreshed with the name cache

/**
 * ⚠ THE ONLY TWO CACHES IN `main/` WITH NO BOUND AT ALL (2026-08-30, swept out during the 17 GB
 * dev incident): no cap, no TTL, no `delete`, no `clear` — every member of every workspace ever
 * enumerated stayed for the life of the process. Every comparable structure here already carries
 * one (`avatar-cache.js › MAX_CACHE`, `legacy-threads.js › LEGACY_THREAD_CAP`,
 * `version-skew.js › SEEN_CAP`, `agent-names.js › MAX_NAMES`). ⚠ NOT what ate the 17 GB — that was `session-narration.js`'s per-flush fan-out
 * and abandoned `fetch` bodies — and bounded anyway, so nobody has to re-derive "how many members
 * could this operator see" the next time a workspace is added.
 * ⚠ OLDEST-OUT (insertion order) IS THE RIGHT EVICTION rather than an LRU because
 * `refreshNameCache` REWRITES every member it sees once per reconcile: a still-watched
 * workspace's members are re-inserted continuously, one the operator left never is. A miss is
 * not a failure — `displayNameFor` answers 'A teammate'. Pinned by test/listener-name-cache.test.mjs.
 */
const MAX_CACHED_MEMBERS = 1000;

function cacheMember(cache, userId, value) {
  if (cache.has(userId)) cache.delete(userId); // re-insert so the order is "last seen"
  cache.set(userId, value);
  while (cache.size > MAX_CACHED_MEMBERS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

// ── Identity ─────────────────────────────────────────────────────────────────
// Resolve the operator's own user id so we never self-trigger. Layered so it
// works for BOTH deep-link sessions (stored JWT) and cookie-only web sign-ins
// (H2): (1) stored session blob, (2) the Supabase auth cookie's JWT `sub`,
// (3) the /api/workspaces/me whoami endpoint as a last resort.
async function resolveOperatorUserId(preferWorkspaceId) {
  let id = auth.getUserId();
  diag('identity tier1 (stored blob):', id ? 'hit' : 'miss');
  if (!id) {
    id = await auth.getUserIdFromCookies();
    diag('identity tier2 (cookie jwt):', id ? 'hit' : 'miss');
  }
  if (!id) {
    try {
      const res = await apiFetch('/api/workspaces/me', {
        workspaceId: preferWorkspaceId,
        timeoutMs: 15000,
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.userId) id = d.userId;
      }
      diag('identity tier3 (whoami):', res.ok ? `hit ${res.status}` : `miss ${res.status}`);
    } catch (err) {
      diag('identity tier3 (whoami): error', err && err.message);
    }
  }
  return id || null;
}

// ── Display-name cache (Feature B/C) ─────────────────────────────────────────
// Requester + target names for notification copy. Filled once per workspace per
// reconcile from the workspace members listing. Falls back to 'A teammate'.
function displayNameFor(userId) {
  return (userId && nameCache.get(userId)) || 'A teammate';
}

// The member's remote avatar URL (Google photo etc.), cached from the members DTO
// for the session window's main-fetched data: URI pipeline (avatar-cache.js). Null
// when unknown. NEVER handed to the renderer as a URL — only as a bounded data: URI.
function avatarUrlFor(userId) {
  return (userId && avatarUrlCache.get(userId)) || null;
}

async function refreshNameCache(ws) {
  // Canonical `{slug}-{publicId}` segment resolves by publicId (no legacy-slug
  // redirect event). Cookie-authed (withUserAuth); X-Workspace-Id is harmless.
  //
  // GUARDED, like its twins (channel-listener.js reconcile, channel-context.resolve),
  // which both yield null on a DTO missing either half. This one interpolated blind:
  // a workspace with no `publicId` produced `slug-undefined`, which 404s, and the
  // whole name+avatar cache for that workspace then stayed empty — so every peer
  // rendered as "A teammate" with only a `namecache miss 404` line to explain it.
  const segment = ws && ws.slug && ws.publicId ? `${ws.slug}-${ws.publicId}` : null;
  if (!segment) {
    diag('namecache skip — workspace DTO has no slug/publicId', (ws && ws.id) || '?');
    return;
  }
  try {
    const res = await apiFetch(`/api/workspaces/${encodeURIComponent(segment)}/members`, {
      workspaceId: ws.id,
      timeoutMs: 15000,
    });
    if (!res.ok) {
      diag('namecache miss', res.status, 'ws', ws.slug);
      return;
    }
    const members = normalizeList(await res.json(), 'members');
    for (const mem of members) {
      if (mem && mem.userId) {
        const dn = mem.displayName || mem.email || null;
        if (dn) cacheMember(nameCache, mem.userId, dn);
        // Cache the avatar URL alongside the name (covers the operator AND every peer,
        // since the members list includes the operator). Consumed only by avatar-cache.
        if (mem.avatarUrl) cacheMember(avatarUrlCache, mem.userId, mem.avatarUrl);
      }
    }
    diag('namecache loaded', members.length, 'ws', ws.slug);
  } catch (err) {
    diag('namecache error', err && err.message);
  }
}

module.exports = {
  resolveOperatorUserId,
  displayNameFor,
  avatarUrlFor,
  refreshNameCache,
};
