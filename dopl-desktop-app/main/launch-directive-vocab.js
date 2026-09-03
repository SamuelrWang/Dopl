// THE LAUNCH-DIRECTIVE **VOCABULARY** — every frozen list, bound and pattern the orchestrator
// lane's two halves share, and nothing that reads or writes a row.
//
// ⚠ **SPLIT OUT OF `launch-directive-wire.js` ON 2026-09-02, AT THE §1 CAP** (that file measured
// 512 of 500 once the tenth refusal word landed with its argument). F-415 named this seam a day
// earlier and named the reason it matters more here than elsewhere: **this is where the wire's
// CLAIMS are written down** — the closed refusal enum, the four kinds, the two frozen mode
// orders — so it is precisely the module whose comments must stay correctable, and a file at the
// cap cannot absorb a comment. It has already been wrong twice about `chain` alone.
//
// ⚠ **IT IS A LEAF AND MUST STAY ONE.** It requires nothing, so there is no cycle for
// `launch-directive-wire.js` to re-export it through, and the two halves F-415 describes
// (`directiveFrom` reading a row, `decideBody`/`refusalFor` writing an answer) go on sharing
// exactly this and nothing else.
//
// ⚠ **EVERY NAME HERE IS RE-EXPORTED BY `launch-directive-wire.js`, VERBATIM.** No caller and no
// test changed with the split; `wire.REFUSAL_REASONS` is still the address. Import from here only
// in code that has no business with the wire's coercion.
//
// PURE — no electron, no network, no store.

// THE TABLE the second `postgres_changes` binding names (`main/realtime.js › addChannel`).
const DIRECTIVE_TABLE = 'channel_launch_directives';

// ⚠ THESE WERE THE GUESS AND ALL THREE ARE NOW CONFIRMED against the route files (header above;
// the suite re-measures it). All are authenticated (cookie auth via `main/api.js`, which carries
// the shared 401 repair). The two writes are POSTs — a claim is a COMPARE-AND-SWAP and a decision
// is a write — and the backstop READ is a GET on the collection.
const ROUTES = {
  // CAS: "give me this directive if it is still pending and still mine". Losing is normal.
  claim: '/api/channels/launch-directives/claim',
  // The terminal write: launched + agent id, or refused + one of the seven words.
  decide: '/api/channels/launch-directives/decide',
  // The breaker-open backstop: what is still pending for me in this workspace.
  pending: '/api/channels/launch-directives',
};

// The row's own status vocabulary, as the other lane stated it.
const STATUS_PENDING = 'pending';
const STATUS_CLAIMED = 'claimed';
const STATUS_LAUNCHED = 'launched';
// ⚠ THE NON-LAUNCH KINDS' SUCCESS (2026-09-01). `launched` is NOT reused for an
// end: this row is read back by the orchestrator that filed it and rendered into
// an agent-facing sentence, and the word "launched" on the record of an agent
// being STOPPED is the one kind of wrong nothing downstream can detect. The
// column CHECK pairs each with its kind, so the two can never be confused at rest.
const STATUS_DONE = 'done';
const STATUS_REFUSED = 'refused';
const STATUS_EXPIRED = 'expired';
const STATUSES = [STATUS_PENDING, STATUS_CLAIMED, STATUS_LAUNCHED, STATUS_DONE,
  STATUS_REFUSED, STATUS_EXPIRED];

// ── THE DIRECTIVE KINDS (2026-09-01, Samuel's external end/rename ruling) ──────
//
// ⚠ **ONE MAILBOX, THREE VERBS.** `end_agent` and `rename_agent` existed only
// INSIDE a desktop-spawned session (`agent-self-ops.js`); an EXTERNAL agent
// holding the operator's own credential could START agents and never stop or
// label them, because no server can reach this process. The launch mailbox is the
// only mechanism that crosses that gap, so the verbs became KINDS of directive.
//
// ⚠ **THE KINDS DO NOT SHARE A CONSENT GATE, AND THAT IS THE LOAD-BEARING FACT
// FOR EVERY READER OF THIS MODULE.** `launch` is gated by
// `channel-prefs.js › getOrchestratorLaunch` ("THE TOGGLE IS THE CONSENT",
// INVARIANTS §6). `end` and `rename` are NOT — `agent-self-ops.js`'s header
// carries the whole argument for the in-process twins of these two verbs, on the
// same subjects: a STOP verb and a DISPLAY verb widen nothing, so the failure
// direction of an abused call is an agent that stops or a card that reads
// differently, on the machine of the operator whose agents they all are. The
// toggle gates LOCAL COMPUTE BEING SPENT; these spend none.
//
// ⚠ AN UNKNOWN KIND COLLAPSES TO `launch` IN `directiveFrom`, WHICH IS THE SAFE
// DIRECTION AND NOT AN OVERSIGHT: the column DEFAULTs to `launch`, every row
// written before 2026-09-01 is one, and a launch is the branch that is FULLY
// GATED. A future fourth kind reaching an older build is therefore gated rather
// than silently dispatched — and the launch branch will refuse it anyway, because
// a directive with no goal and no template starts a stand-by agent rather than
// doing something nobody asked for.
const KIND_LAUNCH = 'launch';
const KIND_END = 'end';
const KIND_RENAME = 'rename';
// ── THE FOURTH KIND (2026-09-01, the agent-efficiency wave) ───────────────────
//
// ⚠ **IT IS THE ONLY NON-LAUNCH KIND THAT STAYS BEHIND THE CONSENT TOGGLE, AND
// THAT IS THE WHOLE REASON IT IS SPELLED OUT SEPARATELY FROM THE OTHER TWO.**
// `end` and `rename` ride free because a STOP verb and a DISPLAY verb widen
// nothing (`directive-agent-ops.js`'s header carries that argument). A POSTURE
// does the opposite: Axis A at `bypass` pre-approves work tools on hardware this
// operator pays for, which is LOCAL COMPUTE BEING SPENT — the exact thing
// `getOrchestratorLaunch` exists to gate. Reading the three non-launch kinds as
// one class would hand an un-armed machine the widest half of the launch lane
// without the launch.
const KIND_SET_MODE = 'set_agent_mode';
const KINDS = [KIND_LAUNCH, KIND_END, KIND_RENAME, KIND_SET_MODE];

// ⚠ WHICH KINDS THE MACHINE-WIDE CONSENT TOGGLE GATES, AS DATA RATHER THAN AS A
// CONDITION IN `handle`. Two readers ask this question — the dispatch gate and the
// suite that pins it — and a second `d.kind === … || d.kind === …` chain is how a
// fifth kind comes to be admitted by whichever reader nobody updated.
const KINDS_NEEDING_LAUNCH_CONSENT = [KIND_LAUNCH, KIND_SET_MODE];

// ⚠ THE TWO AXES, RESTATED — and the restatement is forced, not lazy. This block is
// PURE (no require below the sentinel) so its suite can evaluate it verbatim, and
// `session-profiles.js` is the authority. `test/directive-set-mode.test.mjs` drives
// the two lists against that module's own exports rather than trusting this
// comment, which is the same pin `channel-prefs.js` takes for the same copies.
//
// ⚠ **NARROWEST FIRST, AND THE ORDER IS LOAD-BEARING HERE TOO.** The bound this
// lane applies is "never wider than the operator's own stored channel posture", and
// `launch-posture.js › narrowTo` implements that as an INDEX COMPARISON over these
// arrays. Re-ordering either one silently inverts the bound. ⚠ This comment said
// `directive-agent-ops.js` until 2026-09-02 — that module CALLS `narrowTo`, along
// with `launch-directive-spawn.js`, and neither owns it. Both lanes take the ONE
// implementation, which is the whole reason a posture cannot be widened on one of
// them and not the other.
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

// ⚠ THE WORDS, VERBATIM AND CLOSED. Not a guess — see the header.
// ⚠ SEVEN SINCE 2026-08-22 (agent templates). `no-template` is what this machine answers when a
// directive names a template its OPERATOR cannot resolve — deleted, or invisible to them though
// visible to the orchestrator that named it. The two fences on this lane belong to DIFFERENT
// PEOPLE, which is why that is a real state and not a bug.
// ⚠ IT IS DECLARED HERE BEFORE IT HAS A PRODUCER, DELIBERATELY, and the direction is the safe
// one: `directiveFrom` and `decideBody` NARROW to this list, so a word the list lacks is dropped
// rather than sent. Declaring it early costs nothing; discovering it missing at the moment the
// producer lands costs a refusal that reaches an orchestrator as `no-bridge`, which reads as the
// operator having turned the lane off.
// ⚠ AND THE COLUMN CHECK CAUGHT UP ON 2026-08-23. This list ran one word ahead of
// `channel_launch_directives_refusal_reason_check` for a day, which was safe only because nothing
// produced the word. `launch-directives.js › spawn` now DOES (resolve-at-claim), and
// `20260823140000_channel_launch_directives_template.sql` widens the CHECK in the same wave.
// ⚠ `template-approval` IS NOT A MEMBER AND MUST NOT BECOME ONE. That word is this machine's
// answer to its OWN RENDERER when a foreign template's first run needs one human click
// (`session-launch-op.js › launchFromButton`). There is no human at the keyboard on the directive
// lane — the launch-over-MCP toggle IS the standing consent there (Samuel, OQ-3) — so it can never
// be produced here, the column cannot store it, and `refusalFor` would map it to `no-bridge`
// anyway, which would read to an orchestrator as the operator having turned the lane off.
// ⚠ NINE SINCE 2026-09-01 (external end / rename). Both new words are ones this
// tree ALREADY answers for these exact verbs in-process — `agent-self-ops.js ›
// endVerdict` returns `no-session`, and `agent-names.js › sanitizeName`'s refusal
// is what `bad-name` reports — lifted onto the wire so the same fact reads the
// same way from outside. ⚠ `no-session` is deliberately the DIRECTION lane's
// spelling too (`agent-direction-wire.js`): two vocabularies disagreeing about
// how to say "that agent is not here" is how a render learns to guess.
// ⚠ AND THE COLUMN CHECK LANDS IN THE SAME WAVE THIS TIME
// (`20260907120000_channel_launch_directives_kind.sql`) — the 2026-08-22 window,
// where this list ran one word ahead of the CHECK, is exactly what that
// sequencing avoids: a `decide` carrying a word the CHECK lacks passes zod, passes
// the route, and is refused AT REST.
// ⚠ TEN SINCE 2026-09-02. `no-chain` splits a fact off `no-bridge`: a directive that asked to
// CHAIN in a channel where the operator has not enabled it used to answer the same word this
// machine sends when it is not watching that channel at all. An orchestrator reading "this
// machine could not take it" retries elsewhere; reading `no-chain` it names the setting
// (`launch-posture.js › CHAIN_SETTING`) and asks the operator for one toggle. T24's rule — a
// refusal explainable without opening the repo — applied to the one refusal that named nothing.
// ⚠ Its CHECK lands in the SAME wave (`20260910120000_channel_launch_directives_posture.sql`
// §3A), which is the 2026-08-22 sequencing lesson applied rather than re-learned.
const REFUSAL_REASONS = ['cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
  'no-template', 'no-session', 'bad-name', 'no-chain'];

// The keys this desktop puts on the wire, and the ones it reads back. Stated as data so the
// suite can assert them without a live route, and so a route that lands with different names
// fails in ONE place.
// ⚠ THE THREE `applied*` KEYS JOINED THE DECIDE ON 2026-09-01 (T24's echo) and are the LAUNCHED
// branch's only. They do not GATE the body — `decideBody` builds it — but this list is the
// module's stated answer to "what crosses", and one that omits a field that really does is worse
// than none.
const REQUEST_KEYS = {
  claim: ['directiveId'],
  decide: ['directiveId', 'status', 'agentId', 'refusalReason',
    'appliedTools', 'appliedMessages', 'appliedChain'],
};

// ⚠ `agent-names.js › MAX_NAME`, RESTATED AS A WIRE BOUND. It is the SAME number
// and it is checked TWICE on purpose: here because an unbounded string from a
// server row has no business travelling into main at all, and there because that
// store is the authority on what it will hold. ⚠ A name this narrowing TRUNCATED
// rather than refused would be stored silently altered, so `directiveFrom` keeps
// the raw value's length and lets `sanitizeName` refuse it — see its note.
const TARGET_NAME_MAX = 60;
const RESPONSE_KEYS = { claim: ['ok', 'directive', 'reason'] };

// ⚠ **`UUID_RE` IS NOT HERE, AND THAT IS A DECISION.** It stays in
// `launch-directive-wire.js` beside `directiveFrom`, its only reader — the census in
// `test/uuid-rule-parity.test.mjs` names the FILES that carry their own copy of that rule and
// why each one cannot take `ipc-guards.js › isUuid`, and moving the copy would have been a
// silent edit to that census rather than the review it says a new entry is.

// ⚠ THE INSTANCE-ID SHAPE, and it is the SAME anchored pattern as `agent-id.js ›
// AGENT_ID_RE`, `schema-launch.ts`'s zod and both column CHECKs. Restated here
// rather than required, because this block is PURE — its suite slices it and
// evaluates it with no module system — and `agent-id.js` is not reachable from
// inside the sentinel. ⚠ The suite drives this constant against `agent-id.js`'s
// own source, so the two cannot drift.
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

/** Bounded, whitespace-collapsed display text, or ''. */
function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// ⚠ THE GOAL'S BOUND. It becomes the wake turn's fenced request body
// (`session-seed.js › takeFraming`), so it is COUNTERPARTY-INFLUENCEABLE PROMPT INPUT and the
// same discipline every other body on that path follows applies: bounded here, fenced there,
// never in the trusted preamble. 4 000 characters is well past a real instruction and well
// short of anything that could crowd a turn.
const GOAL_MAX = 4000;

// ⚠ THE TEMPLATE NAME'S BOUND — `agent_templates.name`'s own 120, and the same number
// `channel_launch_directives.template_name`'s CHECK enforces at rest. It is not prompt input on
// this lane (the ROLE BLOCK's name comes from the OPERATOR's own resolve, never from the wire),
// so this is a display/diagnostic bound; it is bounded anyway because an unbounded field from a
// server row has no business travelling into main at all.
const TEMPLATE_NAME_MAX = 120;

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
  REQUEST_KEYS,
  RESPONSE_KEYS,
  TARGET_NAME_MAX,
  AGENT_ID_RE,
  GOAL_MAX,
  TEMPLATE_NAME_MAX,
  text,
};
