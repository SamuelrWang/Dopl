// First-use approval for another member's agent identity: their instructions run on this machine as
// this operator, so a human approves each foreign identity once, before its first run.
// Machine-local in electron-store and never server-writable — a credential-holding agent must not be
// able to pre-approve itself across the fleet. Keyed by identity id (a decision about a thing, so an
// edit keeps it); default deny. Own identities and the directive lane never reach this store.
// Re-exported from `channel-prefs.js`.

const Store = require('electron-store');
const { diag } = require('./diag');

// Its own handle on the one electron-store document (channel-prefs imports this module back).
const store = new Store();

const IDENTITY_APPROVAL_KEY = 'approvedAgentIdentities'; // { [identityId]: true }
// The pre-rename key, read as a fallback so older approvals survive; never written.
const LEGACY_APPROVAL_KEY = 'approvedAgentTemplates';

// Bounded (written from a launch path); oldest key out.
const MAX_APPROVED_IDENTITIES = 200;

function isIdentityApproved(identityId) {
  if (!identityId) return false;
  try {
    return [IDENTITY_APPROVAL_KEY, LEGACY_APPROVAL_KEY].some((key) => {
      const map = store.get(key);
      return !!(map && typeof map === 'object' && map[identityId] === true);
    });
  } catch (_err) {
    return false; // an unreadable store is not a grant
  }
}

// Diag lines keep the `channel-prefs:` prefix so support logs stay greppable across releases.
function approveIdentity(identityId) {
  if (!identityId) return false;
  try {
    const map = store.get(IDENTITY_APPROVAL_KEY);
    const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
    const keys = Object.keys(next);
    if (keys.length >= MAX_APPROVED_IDENTITIES) delete next[keys[0]];
    next[identityId] = true;
    store.set(IDENTITY_APPROVAL_KEY, next);
  } catch (err) {
    diag('channel-prefs: could not persist an identity approval —', err && err.message);
    return false;
  }
  diag('channel-prefs: identity approved', String(identityId).slice(0, 8));
  return true;
}

module.exports = {
  IDENTITY_APPROVAL_KEY,
  isIdentityApproved,
  approveIdentity,
};
