// THE LAUNCH-DIRECTIVE WIRE CONTRACT — the desktop's local statement of a shape the SERVER owns.
//
// ⚠ WHY A CONTRACT MODULE EXISTS AT ALL, AND IT IS NOT THE USUAL REASON. This tree's discipline
// is to pin a cross-boundary shape against the OTHER SIDE'S SOURCE — `session-state-push`'s
// suite reads `schema-sessions.ts` and evaluates its real `SESSION_KEY_RE`, precisely because a
// fixture that agrees with itself is the "asserted as correct by a test on one side of a
// boundary the other side violates" failure. That is still the right rule and the server half has
// landed, so it applies here in full: the suite below drives every claim in this header against
// the OTHER TREE'S SOURCE, not against a fixture.
//
// ── ⚠ WHAT IS PINNED (re-measured 2026-08-23; F-273 CLOSED, F-291) ─────────────────────────
//
// The server lane landed PARTWAY through this work and has since finished. This block is the
// measured picture, and the suite drives every claim in it (`find src/app/api/channels -name
// route.ts`, `grep -n 'export const GET' …`).
//
//   ✅ THE THREE PATHS THIS LANE SPENDS ARE CONFIRMED, not assumed:
//      `POST /api/channels/launch-directives/claim`  -> `{ directive }`
//      `POST /api/channels/launch-directives/decide` -> `{ directive }`
//      `GET  /api/channels/launch-directives`        -> `{ directives }`
//      All three are `withWorkspaceAuth`. The claim's parse takes three envelope shapes anyway;
//      see its note in `launch-directives.js › claim` for why that is not laziness.
//   ✅ THE BODY SHAPES ARE `schema-launch.ts`'s, field for field. `LaunchClaimSchema` is
//      `{ directiveId: uuid }`; `LaunchDecideSchema` is a DISCRIMINATED UNION (`launched`
//      REQUIRES `agentId`, `refused` REQUIRES `refusalReason`) — which is exactly why
//      `decideBody` has two shapes and no third.
//   ✅ `REFUSAL_REASONS` is the same SEVEN words, in the same order, as
//      `schema-launch.ts › LaunchRefusalReasonSchema` and the column CHECK — which
//      `supabase/migrations/20260823140000_channel_launch_directives_template.sql` widened to
//      admit `no-template` (⚠ WRITTEN; applied is a measurement, INVARIANTS §12).
//
//   ✅ **`ROUTES.pending` NAMES A READ THAT EXISTS. F-273 IS CLOSED (2026-08-22).**
//      `src/app/api/channels/launch-directives/route.ts › handleGet`, exported as
//      `GET = withWorkspaceAuth(handleGet)` over `service-launch.ts ›
//      listPendingLaunchDirectives`, answering the `{ directives }` envelope `pollWorkspace`
//      reads. The rows are the AUTHENTICATED operator's own pending ones and nobody else's —
//      `server/repository-launch.ts › listPendingLaunchDirectives` fences the SELECT on
//      `operator_user_id`.
//      ⚠ **NO REPOINT WAS NEEDED**: the server landed the read on the COLLECTION path this
//      module had already guessed, so `ROUTES.pending` is unchanged from the day it was a guess.
//      ⚠ AND THE DTO CARRIES `operatorUserId` SINCE F-284. Without it, `directiveFrom` yielded
//      `''` for every POLLED row and `launch-directives.js › handle`'s local owner re-check
//      dropped all of them — the backstop ran, looked healthy, and recovered nothing.
//
// ⚠ `pollWorkspace`'s 404 SELF-DISABLE IS NOT A FILED GAP AND IS NOT DEAD CODE TO CLEAR. It is
// the OLDER-DEPLOYMENT degradation (INVARIANTS §13 — an older peer is supported): a server that
// has not shipped the route still answers 404, and standing down there is exactly right, one
// dead request per run instead of one per minute. **Do not delete it as the leftover half of a
// half-built thing. It is neither half nor leftover.**
//
// ⚠ ONE SHAPE WAS NEVER A GUESS: `REFUSAL_REASONS`. It is this tree's existing refusal
// vocabulary, verbatim — `session-launch.js › launch` produces it, `session-ipc-ops.js ›
// sessions:launch` answers with it, `trigger.js` handles it, `use-agents-panel.ts ›
// launchRefusalText` renders it — and `schema-launch.ts › LaunchRefusalReasonSchema` carries the
// same seven words in the same order. The suite drives BOTH lists against each other.
//
// PURE below the sentinel — no electron, no network, no store — so its suite evaluates it
// verbatim and so `launch-directives.js` can require it without dragging anything in.

// ─── BEGIN LAUNCH-DIRECTIVE-WIRE (pure; unit-tested via source extraction) ───────────────

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
// `directive-agent-ops.js › narrowTo` implements that as an INDEX COMPARISON over
// these arrays. Re-ordering either one silently inverts the bound.
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
const REFUSAL_REASONS = ['cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
  'no-template', 'no-session', 'bad-name'];

// The keys this desktop puts on the wire, and the ones it reads back. Stated as data so the
// suite can assert them without a live route, and so a route that lands with different names
// fails in ONE place.
const REQUEST_KEYS = { claim: ['directiveId'], decide: ['directiveId', 'status', 'agentId', 'refusalReason'] };

// ⚠ `agent-names.js › MAX_NAME`, RESTATED AS A WIRE BOUND. It is the SAME number
// and it is checked TWICE on purpose: here because an unbounded string from a
// server row has no business travelling into main at all, and there because that
// store is the authority on what it will hold. ⚠ A name this narrowing TRUNCATED
// rather than refused would be stored silently altered, so `directiveFrom` keeps
// the raw value's length and lets `sanitizeName` refuse it — see its note.
const TARGET_NAME_MAX = 60;
const RESPONSE_KEYS = { claim: ['ok', 'directive', 'reason'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * A REALTIME FRAME OR A POLLED ROW -> THE FIELDS THIS DESKTOP WILL ACT ON, or null.
 *
 * ⚠ IT IS A NARROWING, NOT A VALIDATION PASS, and the distinction is the security content. This
 * function does not decide that a directive is legitimate — the CLAIM does, over an
 * authenticated route, against RLS. What it does is refuse to carry anything the desktop has no
 * business reading: an unrecognised key never reaches a caller, so a widened table cannot start
 * influencing this machine by accident.
 *
 * ⚠ `id` AND `channelId` MUST BE UUIDS OR THE ROW IS NOTHING. `channelId` is about to be handed
 * to `channel-listener.js › watchedChannel` and then to a spawn; `id` is about to be POSTed.
 * ⚠ `operatorUserId` IS CARRIED BUT NOT TRUSTED HERE — the caller re-checks it against the live
 * identity, because the realtime FILTER is workspace-wide (see `launch-directives.js`).
 *
 * ── ⚠ THE TEMPLATE PAIR, AND WHY BOTH HALVES HAD TO BE ADDED HERE (2026-08-23) ────────────
 *
 * **THIS FUNCTION IS WHERE A FIELD SILENTLY NEVER ARRIVES.** It is a literal whitelist, so a
 * column the server adds and this list does not name is dropped without a word — which is the
 * point of the narrowing and is also the one way to ship "templates over the directive lane" and
 * have it do nothing at all. `template_id` AND `template_name` are both named below.
 *
 * ⚠ AND IT IS BOTH OR NEITHER. `template_id` is `ON DELETE SET NULL`, so a directive whose
 * template was deleted between CREATE and CLAIM arrives with a NULL id — indistinguishable, on
 * the id alone, from a directive that named no template. Those two get OPPOSITE answers: no
 * template requested ⇒ launch blank; template DELETED ⇒ REFUSE `no-template`, because the
 * orchestrator picked an IDENTITY and an agent silently wearing none is not noticed for several
 * turns (spec E-4, F-1). The NAME is what survives the SET NULL and makes the difference legible,
 * so narrowing it away would re-create exactly the ambiguity the server added a column to close.
 */
function directiveFrom(raw, workspaceId) {
  const r = raw || {};
  const id = String(r.id || '');
  const channelId = String(r.channel_id || r.channelId || '');
  if (!UUID_RE.test(id) || !UUID_RE.test(channelId)) return null;
  // ⚠ BOTH SPELLINGS, for the same reason `taskId` knows three: a REALTIME frame is the raw row
  // (`template_id`) and the CLAIM's answer is the server DTO (`templateId`).
  const templateId = String(r.template_id || r.templateId || '');
  // ⚠ THREE SPELLINGS, AND ALL THREE ARE REAL (measured 2026-08-22). A REALTIME frame is the raw
  // row (`task_id`); the SERVER DTO renames it (`service-launch.ts › toDirective` answers
  // `threadId`, because "thread" is the domain word and "task" is the column's); `taskId` is this
  // tree's own wire name for the same thing. One row shape reaches this function by two roads
  // and the roads disagree about the name, so the function knows all of them rather than a caller
  // having to.
  const taskId = String(r.task_id || r.threadId || r.taskId || '');
  const status = String(r.status || '');
  // ⚠ THE TARGET OF AN END / RENAME — an INPUT, never `agent_id`, which is the
  // OUTPUT a launch produced. Both spellings for `templateId`'s reason: a REALTIME
  // frame is the raw row and the CLAIM's answer is the server DTO.
  const targetAgentId = String(r.target_agent_id || r.targetAgentId || '');
  return {
    id: id,
    // ⚠ UNKNOWN COLLAPSES TO `launch`, WHICH IS THE **GATED** BRANCH — see the
    // KINDS block above. A fourth kind minted by a newer server reaching this
    // build must not be dispatched by a machine that has no branch for it, and
    // must not be silently dropped either (the row would be claimed and never
    // answered); routing it to the fully-consented branch is the only reading
    // that is both safe and honest.
    kind: KINDS.indexOf(String(r.kind || '')) === -1 ? KIND_LAUNCH : String(r.kind),
    workspaceId: String(r.workspace_id || r.workspaceId || workspaceId || ''),
    channelId: channelId,
    // ⚠ '' IS A REAL VALUE AND MEANS CHANNEL-LEVEL, exactly as it does on `sessions:launch`. A
    // non-uuid that is not empty is a thread id this build cannot address, so it collapses to
    // the channel scope rather than being smuggled into a session key.
    taskId: UUID_RE.test(taskId) ? taskId : '',
    operatorUserId: String(r.operator_user_id || r.operatorUserId || ''),
    goal: text(r.goal, GOAL_MAX),
    // Coerced by `session-model.js` at the call site, not here — this module owns the WIRE, and
    // the frozen model list is that module's.
    model: text(r.model, 64),
    // ⚠ '' IS "NO TEMPLATE ID", and a non-uuid collapses to it rather than being carried: this
    // value is about to be interpolated into `/api/agent-templates/<id>/resolve`.
    templateId: UUID_RE.test(templateId) ? templateId : '',
    // ⚠ CARRIED EVEN WHEN THE ID IS EMPTY — that combination IS the deletion signal (E-4). A
    // narrowing that dropped the name whenever the id was missing would throw away the only
    // evidence a template was ever named.
    templateName: text(r.template_name || r.templateName, TEMPLATE_NAME_MAX),
    // ⚠ SHAPE-CHECKED HERE, not merely carried: it is about to be handed to
    // `session-engine.js › controlByTask` as an address and printed into a diag.
    // `''` is "no target", which the caller treats as a refusal on any kind that
    // needs one rather than as "act on whatever is oldest" — there is no
    // oldest-agent fallback on this lane and an end that guessed is unrecoverable.
    targetAgentId: AGENT_ID_RE.test(targetAgentId) ? targetAgentId : '',
    // ⚠ **`null` AND `''` ARE DIFFERENT AND BOTH ARE REAL, WHICH IS WHY THIS IS
    // NOT `text()`.** `''` is the RENAME'S CLEAR gesture (back to `Agent #<id>`);
    // `null` is "this directive is not a rename". Collapsing them — which every
    // other string field here does, correctly, because none of them has a
    // meaningful empty value — would turn "no rename requested" into "clear the
    // name" on a kind that never asked for one.
    // ⚠ AND IT IS NOT TRUNCATED. `text()` would silently store an altered name;
    // `agent-names.js › sanitizeName` is the authority and REFUSES rather than
    // strips, which is what produces the honest `bad-name`. What this does is
    // refuse to carry an absurd length into main at all.
    targetName: typeof r.target_name === 'string' || typeof r.targetName === 'string'
      ? String(r.target_name !== undefined && r.target_name !== null
        ? r.target_name : r.targetName).slice(0, TARGET_NAME_MAX + 1)
      : null,
    // ⚠ THE TWO AXES A `set_agent_mode` CARRIES, NARROWED TO THE FROZEN ENUMS HERE.
    // `''` is "this axis was not requested", which is a REAL and common value: a
    // directive may move one axis and leave the other alone, and the caller applies
    // only what it was given. A value outside the enum collapses to `''` for
    // `templateId`'s reason — this function is a NARROWING, and a mode this build has
    // never heard of must not be carried toward a reducer that would coerce it to the
    // most restrictive member without anybody saying so.
    // ⚠ BOTH `''` MEANS THE DIRECTIVE ASKED FOR NOTHING THIS BUILD CAN DO, and the
    // caller refuses rather than reporting a no-op as success — see `setAgentMode`.
    targetToolMode: TOOL_MODES.indexOf(String(r.target_tool_mode || r.targetToolMode || '')) === -1
      ? '' : String(r.target_tool_mode || r.targetToolMode),
    targetMessageMode: MESSAGE_MODES.indexOf(String(r.target_message_mode || r.targetMessageMode || '')) === -1
      ? '' : String(r.target_message_mode || r.targetMessageMode),
    // ── ⚠ THE POSTURE A **LAUNCH** ASKS TO START ON (2026-09-01, T24) ────────────────────
    // Narrowed to the same frozen enums, and `''` means "not asked for" exactly as above —
    // which resolves to the operator's stored channel pair, i.e. the pre-T24 behaviour byte
    // for byte. ⚠ THEY ARE SEPARATE FIELDS FROM THE `target*` PAIR ABOVE AND MUST STAY SO:
    // one names the posture a NEW session starts on, the other the posture a RUNNING one moves
    // to, and merging them would let a `set_agent_mode` be answered by a launch's fields on a
    // row that carried both.
    // ⚠ **NEITHER DECIDES ANYTHING.** `launch-posture.js › resolvePosture` clamps both to the
    // operator's own durable channel pair before they reach a spawn — the lane's standing
    // invariant, which T24 does not get to relax. That module's header carries the argument,
    // including why the ticket's "unless the caller is the operator" carve-out is the whole set.
    startToolMode: TOOL_MODES.indexOf(String(r.start_tool_mode || r.startToolMode || '')) === -1
      ? '' : String(r.start_tool_mode || r.startToolMode),
    startMessageMode: MESSAGE_MODES.indexOf(String(r.start_message_mode || r.startMessageMode || '')) === -1
      ? '' : String(r.start_message_mode || r.startMessageMode),
    // ⚠ A TRI-STATE, NOT A BOOLEAN, AND THE THIRD VALUE IS LOAD-BEARING. `true` is "I need this
    // agent to be able to launch workers"; `null` is "I did not ask", which inherits the
    // channel's setting silently as every launch did before T24. Collapsing them would turn
    // every ordinary launch into a request, and a request the channel denies is a REFUSAL.
    chain: r.chain === true || r.chain === 'true' ? true : null,
    status: STATUSES.indexOf(status) === -1 ? '' : status,
    agentId: String(r.agent_id || r.agentId || ''),
  };
}

/**
 * `launch()`'s SKIP RESULT -> one of the seven words.
 *
 * ⚠ `disabled` IS THE ONE SHAPE WITH NO MEMBER OF ITS OWN, and it maps to `no-bridge`. It means
 * `launch` was called without `windowless` (unreachable from this lane — the call site sets it
 * literally) or `startSession` rolled back because no surface could be attached. Either way the
 * honest thing to tell an orchestrator is "this machine could not take it", which is what
 * `no-bridge` says. ⚠ AN UNKNOWN SHAPE LANDS THERE TOO rather than being passed through: the
 * vocabulary is CLOSED on the wire, and an EIGHTH word from a future refusal would be a value
 * the reading side has no copy for.
 */
function refusalFor(skipped) {
  const s = String(skipped || '');
  return REFUSAL_REASONS.indexOf(s) === -1 ? 'no-bridge' : s;
}

/** The claim body. */
function claimBody(directiveId) {
  return { directiveId: String(directiveId || '') };
}

/**
 * The decision body — LAUNCHED with an address, or REFUSED with a word. Never both, and never
 * neither: a directive this machine claimed and then said nothing about is the one outcome the
 * orchestrator cannot act on, which is why `decide` has no third shape.
 */
function decideBody(directiveId, outcome) {
  const o = outcome || {};
  const agentId = String(o.agentId || '');
  if (agentId) {
    return { directiveId: String(directiveId || ''), status: STATUS_LAUNCHED, agentId: agentId };
  }
  // ⚠ THE NON-LAUNCH KINDS' SUCCESS (2026-09-01). ORDER MATTERS AND IS THE WHOLE
  // CORRECTNESS OF THIS FUNCTION: `agentId` is checked FIRST, so a launch can
  // never fall into this branch, and `done` is checked before the refusal
  // fallthrough, so an end that succeeded is never reported as `no-bridge`.
  // ⚠ IT CARRIES NO ID, deliberately — the row already NAMES its target, and a
  // second id here would be a field this machine could get wrong about a row it
  // did not write. The route's schema has no field for one.
  if (o.done === true) {
    return { directiveId: String(directiveId || ''), status: STATUS_DONE };
  }
  return {
    directiveId: String(directiveId || ''),
    status: STATUS_REFUSED,
    refusalReason: refusalFor(o.refused),
  };
}

// ─── END LAUNCH-DIRECTIVE-WIRE ───────────────────────────────────────────────────────────

module.exports = {
  DIRECTIVE_TABLE,
  ROUTES,
  STATUSES,
  STATUS_PENDING,
  STATUS_CLAIMED,
  STATUS_LAUNCHED,
  STATUS_DONE,
  STATUS_REFUSED,
  STATUS_EXPIRED,
  KINDS,
  KIND_LAUNCH,
  KIND_END,
  KIND_RENAME,
  KIND_SET_MODE, // 2026-09-01: the posture verb — the one non-launch kind the toggle gates
  KINDS_NEEDING_LAUNCH_CONSENT,
  TOOL_MODES,
  MESSAGE_MODES,
  AGENT_ID_RE,
  REFUSAL_REASONS,
  REQUEST_KEYS,
  RESPONSE_KEYS,
  GOAL_MAX,
  TEMPLATE_NAME_MAX,
  TARGET_NAME_MAX,
  directiveFrom,
  refusalFor,
  claimBody,
  decideBody,
};
