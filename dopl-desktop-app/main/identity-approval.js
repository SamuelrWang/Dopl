// FIRST-USE APPROVAL FOR ANOTHER MEMBER'S AGENT TEMPLATE (2026-08-22, OQ-3).
//
// ⚠ **SPLIT OUT OF `channel-prefs.js` ON 2026-08-31**, at the §1 cap and on a REASON rather than
// the count that forced it — the same seam and the same precedent as `orchestrator-consent.js`
// one wave earlier. This file changes when the rules for trusting ANOTHER MEMBER'S standing
// configuration change; `channel-prefs.js` changes when a CHANNEL preference does. The record it
// holds is not keyed by a channel at all, which is the tell: it is keyed by a TEMPLATE ID, and a
// template is a workspace-scoped thing that outlives every channel it is launched into.
// Re-exported from `channel-prefs.js`, so no caller moved.
//
// A `team` or `workspace` template's `instructions` are written by ANOTHER WORKSPACE MEMBER and
// they execute ON THIS MACHINE, in this operator's session, under this operator's credential,
// with this operator's tool profile and KB reach. That is a materially different exposure from
// every other shared-content surface in the product: a shared SKILL is pulled per call and read
// as a procedure, while a shared TEMPLATE is STANDING CONFIGURATION for an autonomous agent.
//
// The fence (`prompt-framing-template.js`) stops WIDENING. It does not stop MISDIRECTION, and
// nothing text-shaped can. What addresses misdirection is INFORMING A HUMAN, once, before the
// first run: the selector's authorship marker, and this — ONE approval, the first time a given
// FOREIGN template launches on THIS MACHINE, with its instructions shown verbatim.
//
// ⚠ IT LIVES IN electron-store BESIDE `orchestratorLaunchEnabled`, AND FOR THAT TOGGLE'S EXACT
// REASON. A spawned session has `Bash` and this operator's Dopl credential is on disk, so any
// surface a Dopl credential can address is disqualified: a server-stored approval lets a
// credential-holding agent PRE-APPROVE ITSELF ACROSS THE FLEET, which is the escalation this
// whole family has to not have. No request, from any credential, to any Dopl endpoint, can write
// this. `Bash` on this machine could rewrite the store file directly — true of every local
// setting, and not what this defends against; the REMOTE path is.
//
// ⚠ KEYED BY TEMPLATE ID, AND APPROVAL IS PER TEMPLATE, NOT PER AUTHOR. Approving Ada's
// "Code Auditor" says nothing about Ada's next template, because the thing the operator read and
// consented to was a specific body of instructions.
// ⚠ IT IS NOT A RECORD OF THE INSTRUCTIONS THEY READ. An edited template keeps its approval,
// deliberately: re-prompting on every edit would train the operator to click through, and the
// author could already have edited it between the approval and the launch. The approval is
// "I have decided to trust this template", which is a decision about a THING, not a diff.
// ⚠ DEFAULT DENY — an absent, corrupt or non-boolean record reads false, the same fail-closed
// rule auto-send and the orchestrator toggle both follow.
//
// ⚠ NOTHING HERE APPLIES TO THE OPERATOR'S OWN TEMPLATES. `authoredByCaller === true` never
// reaches this store: an approval prompt over your own configuration is the noise that teaches
// people to stop reading approval prompts.
// ⚠ NOR TO THE DIRECTIVE LANE. There is no human at the keyboard there, and the answer is
// already written down in `orchestrator-consent.js`: `orchestratorLaunchEnabled` STANDS IN FOR
// THE CLICK. A second machine-local gate for the same threat, guarding the same lane, is a fence
// nobody reads.

const Store = require('electron-store');
const { diag } = require('./diag');

// ⚠ THE SAME `electron-store` INSTANCE SHAPE `channel-prefs.js` USES — `electron-store` is
// backed by ONE JSON file per app, so two instances read and write the same document. Keeping
// its own handle is what lets this module stand alone without importing the file it was split
// out of (which imports it back, through the re-export). Same idiom as `orchestrator-consent.js`.
const store = new Store();

// ⚠ THE DIAG PREFIX STAYS `channel-prefs:` AFTER THE MOVE, exactly as `orchestrator-consent.js`
// kept it. A support log is a vocabulary an operator and a reader grep against; renaming it
// inside a split that changes no behaviour would make one release's logs unfindable from the
// next one's, which is a cost with no buyer.
const TEMPLATE_APPROVAL_KEY = 'approvedAgentTemplates'; // { [templateId]: true }

// Bounded, because the map is written from a launch path and an unbounded local store is the
// shape that has bitten this tree before. Oldest key out; a re-approval is one click.
const MAX_APPROVED_TEMPLATES = 200;

function isTemplateApproved(templateId) {
  if (!templateId) return false;
  try {
    const map = store.get(TEMPLATE_APPROVAL_KEY);
    return !!(map && typeof map === 'object' && map[templateId] === true);
  } catch (_err) {
    return false; // an unreadable store is not a grant
  }
}

function approveTemplate(templateId) {
  if (!templateId) return false;
  try {
    const map = store.get(TEMPLATE_APPROVAL_KEY);
    const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
    const keys = Object.keys(next);
    if (keys.length >= MAX_APPROVED_TEMPLATES) delete next[keys[0]];
    next[templateId] = true;
    store.set(TEMPLATE_APPROVAL_KEY, next);
  } catch (err) {
    diag('channel-prefs: could not persist a template approval —', err && err.message);
    return false;
  }
  diag('channel-prefs: template approved', String(templateId).slice(0, 8));
  return true;
}

module.exports = {
  TEMPLATE_APPROVAL_KEY,
  MAX_APPROVED_TEMPLATES,
  isTemplateApproved,
  approveTemplate,
};
