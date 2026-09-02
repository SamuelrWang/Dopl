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

// ⚠ THE FROZEN VOCABULARIES LIVE IN A LEAF (2026-09-02, F-415's seam, taken at the §1 cap): every
// list, bound and pattern this file used to declare is in `launch-directive-vocab.js`, a module
// that requires nothing. This file destructures them and RE-EXPORTS every one verbatim, so
// `wire.REFUSAL_REASONS`, `wire.KINDS` and the rest are unchanged addresses for every caller and
// every test. ⚠ Do not re-declare one here: two statements of a closed vocabulary is the drift
// the whole lane's suite exists to catch.
const vocab = require('./launch-directive-vocab');
const {
  DIRECTIVE_TABLE, ROUTES,
  STATUS_PENDING, STATUS_CLAIMED, STATUS_LAUNCHED, STATUS_DONE, STATUS_REFUSED, STATUS_EXPIRED,
  STATUSES,
  KIND_LAUNCH, KIND_END, KIND_RENAME, KIND_SET_MODE, KINDS, KINDS_NEEDING_LAUNCH_CONSENT,
  TOOL_MODES, MESSAGE_MODES, REFUSAL_REASONS, REQUEST_KEYS, RESPONSE_KEYS,
  TARGET_NAME_MAX, AGENT_ID_RE, GOAL_MAX, TEMPLATE_NAME_MAX, text,
} = vocab;

// ⚠ **THE UUID RULE STAYS HERE**, with `directiveFrom`, which is its only reader. It is one of
// the handful of hand-copies of that pattern in `main/`, and `test/uuid-rule-parity.test.mjs`
// holds a CENSUS of exactly which files carry one and why — moving it into the vocabulary leaf
// would have edited that census silently instead of taking the review it says a change to it is.
// ⚠ AND THE COPY IS LOAD-BEARING: it is what refuses a directive whose `id` or `channel_id` is
// not a UUID, on a row that arrives over a realtime frame this module does not trust.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // ⚠ A TRI-STATE, NOT A BOOLEAN, AND **ALL THREE VALUES ARE LOAD-BEARING**. `true` is "I need
    // this agent to be able to launch workers"; `false` is "run it with chaining OFF, whatever
    // the channel allows"; `null` is "I did not ask", which inherits the channel's setting
    // silently as every launch did before T24. Collapsing `null` into a request would turn every
    // ordinary launch into one, and a request the channel denies is a REFUSAL.
    //
    // ⚠ **THIS LINE READ `r.chain === true || r.chain === 'true' ? true : null` AND THAT WAS THE
    // BUG (2026-09-01).** A stored `false` fell down the `null` arm and arrived as "did not ask",
    // so it INHERITED the channel setting — which may be ON. `chain: false` could not turn
    // chaining off, and every doc, comment and agent-facing description on the lane said it
    // could. The server has always stored the three states faithfully
    // (`service-launch.ts › createLaunchDirective` uses `?? null`, not `|| null`, for exactly
    // this); it was only this narrowing that flattened them.
    // ⚠ `'false'` IS ACCEPTED BESIDE `false` for the same reason `'true'` is: this row may arrive
    // over a transport that stringifies booleans, and a one-sided coercion is how the two halves
    // of a tri-state stop being symmetric.
    chain: r.chain === true || r.chain === 'true'
      ? true
      : r.chain === false || r.chain === 'false'
        ? false
        : null,
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
 *
 * ── ⚠ THE ECHO TRIO, ON THE LAUNCHED BRANCH ONLY (2026-09-01, T24's echo) ────────────────
 *
 * The posture columns landed as a REQUEST with nothing to answer it: an orchestrator could ask
 * for `bypass/auto_both` and never learn this machine's ceiling clamped it to `auto/auto_inbound`,
 * so it sized its next instruction for room the agent does not have. `launch-directive-spawn.js ›
 * spawn` now hands back what `launch-posture.js › resolveLaunch` settled on; these keys carry it.
 *
 * ⚠ **EMITTED ONLY WHEN THIS MACHINE REALLY HAS A VALUE, AND OMITTED IS "NOT REPORTED".** The
 * server maps an absent key to a NULL column and `channel-ops-launch.ts › postureFacts` renders
 * NULL as the words `not reported` — which is also what a desktop OLDER than this wave produces,
 * and why the route's schema keeps all three OPTIONAL (INVARIANTS §13: an older peer must still
 * be able to decide). Sending `''` would be this machine claiming to report and reporting nothing.
 * ⚠ **NARROWED TO THE FROZEN ENUMS HERE**, as `directiveFrom` narrows the request pair: a mode
 * outside the list would pass zod and hit the column CHECK — a decide refused AT REST for a
 * launch that really happened.
 * ⚠ `appliedChain` IS A BOOLEAN AND `false` IS A REPORT, NOT A SILENCE, hence `typeof` rather than
 * truthiness: "this session may NOT launch workers" is the fact that stops an orchestrator
 * planning for them, and a `||` would delete it — the collapse that made `chain: false`
 * unhonourable on the way IN.
 */
function decideBody(directiveId, outcome) {
  const o = outcome || {};
  const agentId = String(o.agentId || '');
  if (agentId) {
    const body = { directiveId: String(directiveId || ''), status: STATUS_LAUNCHED, agentId: agentId };
    if (TOOL_MODES.indexOf(o.appliedTools) !== -1) body.appliedTools = o.appliedTools;
    if (MESSAGE_MODES.indexOf(o.appliedMessages) !== -1) body.appliedMessages = o.appliedMessages;
    if (typeof o.appliedChain === 'boolean') body.appliedChain = o.appliedChain;
    return body;
  }
  // ⚠ THE NON-LAUNCH KINDS' SUCCESS (2026-09-01). ORDER MATTERS AND IS THE WHOLE
  // CORRECTNESS OF THIS FUNCTION: `agentId` is checked FIRST, so a launch can
  // never fall into this branch, and `done` is checked before the refusal
  // fallthrough, so an end that succeeded is never reported as `no-bridge`.
  // ⚠ IT CARRIES NO ID, deliberately — the row already NAMES its target, and a
  // second id here would be a field this machine could get wrong about a row it
  // did not write. The route's schema has no field for one.
  if (o.done === true) {
    const body = { directiveId: String(directiveId || ''), status: STATUS_DONE };
    // ⚠ THE ECHO RIDES A `done` TOO (2026-09-02), and the column is NOT kind-scoped precisely
    // so it can (`20260910120000_…_posture.sql` §5 asserts that). `set_agent_mode` is the one
    // non-launch kind that settles a posture, and it was answering `taken` with its clamp
    // visible only in the operator's log. ⚠ NARROWED to the frozen enums, like the launched
    // branch: a mode outside the list passes zod and is refused by the column CHECK at rest.
    // ⚠ NO `appliedChain` — a re-posture starts nothing and decides no chaining.
    if (TOOL_MODES.indexOf(o.appliedTools) !== -1) body.appliedTools = o.appliedTools;
    if (MESSAGE_MODES.indexOf(o.appliedMessages) !== -1) body.appliedMessages = o.appliedMessages;
    return body;
  }
  return {
    directiveId: String(directiveId || ''),
    status: STATUS_REFUSED,
    refusalReason: refusalFor(o.refused),
  };
}

// ─── END LAUNCH-DIRECTIVE-WIRE ───────────────────────────────────────────────────────────

module.exports = {
  // ⚠ THE VOCABULARY IS RE-EXPORTED VERBATIM from `launch-directive-vocab.js` — see the require
  // above. Every address a caller or a test already used is unchanged by the 2026-09-02 split.
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
