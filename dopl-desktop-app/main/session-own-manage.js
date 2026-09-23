// The own-machine MANAGE lane: `manage` rename / end / posture aimed at this session's own channel. It takes the
// launch lane's conjunction — Axis B's out half (the ask leaves this machine as a directive row) AND the
// session runtime's widest Axis-A mode (it reaches another process on this Mac) — with NO depth question (a
// launched agent is at the cap by construction, and every coder renames itself on start). It classifies only;
// the claiming machine's consent split still applies (`launch-directives.js › KINDS_NEEDING_LAUNCH_CONSENT`).

// Keyed `<op>.<action>` (F-578): a bare `manage` would admit `launch` and `direct` through a door built for neither.
const { channelOpKey } = require('./channel-op-key');

// An allow list, named explicitly: a key named nowhere gates in every posture.
const OWN_MACHINE_MANAGE_OPS = ['manage.rename', 'manage.end', 'manage.posture'];

// The session runtime's widest mode; lazy, because the runtime layer requires session modules.
const widestToolMode = (runtimeId) => require('./session-profiles-runtime').widestToolModeFor(runtimeId);

// One audit code per action (stopped, relabelled, re-postured are different answers); never an outbound code.
const MANAGE_ALLOW_REASONS = {
  'manage.rename': 'auto-rename-own-machine',
  'manage.end': 'auto-end-own-machine',
  'manage.posture': 'auto-posture-own-machine',
};

// Own channel only: unset or exactly this session's id (a slug is another channel).
function isOwnMachineManage(input, sessionChannelId) {
  const i = input || {};
  if (OWN_MACHINE_MANAGE_OPS.indexOf(channelOpKey(i)) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// Never `deny`: the not-admitted case is a posture the operator can widen, so it stays refusable.
function manageLaneVerdict(args, autoOutbound) {
  const a = args || {};
  return a.toolMode === widestToolMode(a.runtime) && autoOutbound === true ? 'allow' : 'gate';
}

// The allow code for an admitted call, or null; asks `isOwnMachineManage` so a cross-channel call is never narrated as own-machine.
function manageAllowReason(input, sessionChannelId) {
  if (!isOwnMachineManage(input, sessionChannelId)) return null;
  return MANAGE_ALLOW_REASONS[channelOpKey(input || {})] || null;
}

module.exports = {
  OWN_MACHINE_MANAGE_OPS,
  MANAGE_ALLOW_REASONS,
  isOwnMachineManage,
  manageLaneVerdict,
  manageAllowReason,
};
