// Channels listener — WHO THE PEOPLE ARE: the operator's own user id (so a loop never self-triggers)
// and the peer display-name / avatar caches, both read off the workspace members listing.
// `listener-io.js` re-exports these exact function objects (one instance of each cache).

const auth = require('./auth');
const { diag } = require('./diag');

// Lazy, per call: listener-io requires THIS file, so a top-level require would bind a half-built
// module. Call sites stay bare (`apiFetch(...)`) so a suite can slice a function and inject a fake.
const apiFetch = (pathname, opts) => require('./listener-io').apiFetch(pathname, opts);
const normalizeList = (data, key) => require('./listener-io').normalizeList(data, key);

const nameCache = new Map(); // userId -> displayName, refreshed once per reconcile
const avatarUrlCache = new Map(); // userId -> avatarUrl (item 1/5/6), refreshed with the name cache

// Both caches are bounded, oldest-out: `refreshNameCache` re-inserts every member it sees each
// reconcile, so a still-watched workspace's members stay. A miss reads 'A teammate'.
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

/** The operator's user id: the stored session blob, then the auth cookie's JWT `sub`, then `/api/workspaces/me`. */
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

function displayNameFor(userId) {
  return (userId && nameCache.get(userId)) || 'A teammate';
}

/** A member's remote avatar URL, for `avatar-cache.js` only — never handed to a renderer as a URL. */
function avatarUrlFor(userId) {
  return (userId && avatarUrlCache.get(userId)) || null;
}

async function refreshNameCache(ws) {
  // Guarded like its twins: a DTO missing slug or publicId would build `slug-undefined` and 404.
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
