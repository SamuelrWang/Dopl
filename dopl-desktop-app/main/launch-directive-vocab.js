// The launch-directive VOCABULARY: every list, bound and pattern the directive lane shares. A pure
// leaf (requires nothing); `launch-directive-wire.js` re-exports every name. The server owns these
// shapes — each list is mirrored by `schema-launch-modes.ts`, the column CHECKs and the MCP side.

const DIRECTIVE_TABLE = 'channel_launch_directives'; // the second `postgres_changes` binding (`realtime.js`)

// All authenticated (`api.js`); claim is a compare-and-swap, decide a write, pending the backstop read.
const ROUTES = {
  claim: '/api/channels/launch-directives/claim',
  decide: '/api/channels/launch-directives/decide',
  pending: '/api/channels/launch-directives',
};

const STATUS_PENDING = 'pending';
const STATUS_CLAIMED = 'claimed';
const STATUS_LAUNCHED = 'launched';
// A non-launch kind's success: never `launched` on the record of an agent being stopped.
const STATUS_DONE = 'done';
const STATUS_REFUSED = 'refused';
const STATUS_EXPIRED = 'expired';
const STATUSES = [STATUS_PENDING, STATUS_CLAIMED, STATUS_LAUNCHED, STATUS_DONE,
  STATUS_REFUSED, STATUS_EXPIRED];

// One mailbox, four verbs. An unknown kind collapses to `launch` in `directiveFrom` — the fully
// gated branch — so a newer server's kind is gated rather than dispatched blind.
const KIND_LAUNCH = 'launch';
const KIND_END = 'end';
const KIND_RENAME = 'rename';
const KIND_SET_MODE = 'set_agent_mode';
const KINDS = [KIND_LAUNCH, KIND_END, KIND_RENAME, KIND_SET_MODE];

// The kinds behind the machine-wide launch consent: both spend local compute (a posture pre-approves
// work tools). `end` (a stop) and `rename` (display only) widen nothing and stay outside it.
const KINDS_NEEDING_LAUNCH_CONSENT = [KIND_LAUNCH, KIND_SET_MODE];

// Axis A on the wire: every registered runtime's OWN words, as a SET (ruling R3). A word is
// validated and clamped against the launch runtime's descriptor order, never this list's order.
// Mirrors `schema-launch-modes.ts › LAUNCH_TOOL_MODES` and the column CHECKs (suite-pinned).
const TOOL_MODES = [
  'manual', 'accept_edits', 'auto', 'bypass', // claude
  'untrusted', 'granular', 'on-request', 'never', // codex
  'allowlist', 'auto-review', 'run-everything', // cursor
];
// Axis B is runtime-neutral, narrowest first.
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

// The CLOSED refusal vocabulary, mirrored by `schema-launch-modes.ts › LAUNCH_REFUSAL_REASONS`, the
// column CHECK (`20261019120000_…` §7) and the MCP retry advice; a word missing from any of them is
// refused at rest. `identity-approval` must never be a member: it is the button lane's answer to its
// own renderer, and on this lane the launch toggle is the standing consent.
const REFUSAL_REASONS = ['cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
  'no-identity', 'no-session', 'bad-name', 'no-chain', 'no-model'];

// `agent-names.js › MAX_NAME` as a wire bound; `directiveFrom` keeps one char over so an over-long
// name is refused by `sanitizeName` rather than stored truncated.
const TARGET_NAME_MAX = 60;

// The instance-id shape; the same anchored pattern as `agent-id.js › AGENT_ID_RE` (suite-pinned).
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

// A runtime id's SHAPE, not the registry: `launch-directive-spawn.js` asks the registry for
// membership and refuses (`no-sdk`) rather than falling back. Hand-mirrored with
// `schema-launch-modes.ts › LAUNCH_RUNTIME_ID_RE` and the column CHECK (`schema-launch-runtime.test.ts`).
const RUNTIME_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** Bounded, whitespace-collapsed display text, or ''. */
function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// The goal becomes the wake turn's FENCED request body (counterparty-influenceable prompt input).
const GOAL_MAX = 4000;

// `agent_identities.name`'s bound (and the column CHECK's); display/diagnostic only on this lane.
const IDENTITY_NAME_MAX = 120;

// A model id's bound: the server's `schema-launch.ts` `safeLabel("Model", 120)` and `identity-resolve.js › MAX_MODEL`.
const MODEL_MAX = 120;

module.exports = {
  DIRECTIVE_TABLE,
  ROUTES,
  STATUS_PENDING,
  STATUS_CLAIMED,
  STATUS_LAUNCHED,
  STATUS_DONE,
  STATUS_REFUSED,
  STATUS_EXPIRED,
  STATUSES,
  KIND_LAUNCH,
  KIND_END,
  KIND_RENAME,
  KIND_SET_MODE,
  KINDS,
  KINDS_NEEDING_LAUNCH_CONSENT,
  TOOL_MODES,
  MESSAGE_MODES,
  REFUSAL_REASONS,
  TARGET_NAME_MAX,
  AGENT_ID_RE,
  RUNTIME_ID_RE,
  GOAL_MAX,
  IDENTITY_NAME_MAX,
  MODEL_MAX,
  text,
};
