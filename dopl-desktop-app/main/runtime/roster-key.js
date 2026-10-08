// THE BUILD KEY — the one key every last-live answer is filed under (model roster, protocol shape),
// computed HERE from what the adapter says it is running, never typed by an adapter.
//
// ⚠ STRUCTURAL, NOT A CONVENTION (2026-10-08). An adapter used to answer `rosterKey()` as a free-form
// string, and nothing stopped one that forgot the version from handing a new build its predecessor's
// roster and protocol verdict. Now an adapter answers `buildIdentity()` → `{ path, version, account? }`
// and the key is `path@version[#account]`: a different binary or a different version is, by
// construction, a different key. A missing path or version is NO key (nothing persisted, nothing
// reused), never a partial one.
// ⚠ NULL ONLY BY DECLARATION. `descriptor.models.persist === false` is the one way to opt out; an
// adapter that declares persistence and answers no identity is logged once — its answers are simply
// not kept, which is safe, and visible.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** `path@version[#account]`, or null unless both path and version are present. Pure. */
function rosterKeyFor(identity) {
  const i = identity && typeof identity === 'object' ? identity : {};
  const p = str(i.path);
  const v = str(i.version);
  if (!p || !v) return null;
  const a = str(i.account);
  return a ? `${p}@${v}#${a}` : `${p}@${v}`;
}

/** Does this adapter keep last-live answers across restarts? Default yes; `models.persist: false` opts out. */
function persists(descriptor) {
  return !(descriptor && descriptor.models && descriptor.models.persist === false);
}

const warned = new Set();

/** `{ key, accountScoped }` now: `accountScoped` = the identity named an account (a per-account
 *  fingerprint), so a persisted roster is THIS account's list, not merely this build's. Never throws. */
function rosterIdentityOf(adapter) {
  const key = rosterKeyOf(adapter);
  if (!key) return { key: null, accountScoped: false };
  let identity = null;
  try { identity = adapter.runtime.buildIdentity(); } catch (_) { identity = null; }
  return { key, accountScoped: !!(identity && str(identity.account)) };
}

/** The adapter's build key now, or null (opted out, no identity yet, a throw). Never throws. */
function rosterKeyOf(adapter) {
  const d = adapter && adapter.descriptor;
  const fn = adapter && adapter.runtime && adapter.runtime.buildIdentity;
  if (!d || !persists(d) || typeof fn !== 'function') return null;
  let identity = null;
  try { identity = fn.call(adapter.runtime); } catch (_) { identity = null; }
  const key = rosterKeyFor(identity);
  if (!key && !warned.has(d.id)) {
    warned.add(d.id);
    try {
      require('../diag').diag(`roster-key: ${d.id} declares persistence but answered no build identity yet — nothing kept`);
    } catch (_) { /* a key read never fails */ }
  }
  return key;
}

module.exports = { rosterKeyFor, rosterKeyOf, rosterIdentityOf, persists };
