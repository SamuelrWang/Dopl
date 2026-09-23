// THE DIRECTIVE LANE'S SPAWN — one claimed row becoming one session, and nothing else.
//
// §1 SPLIT out of `main/launch-directives.js` on 2026-09-01 (T24), at the hard 500-line cap. The
// seam is real: that module is the WATCHER (arming, the realtime binding, the owner re-check, the
// per-kind consent gate, the CAS, the dedupe ledger, the backstop poll) and changes when the LOCAL
// POLICY for acting on a row changes; this is the LAUNCH ASSEMBLY and changes when what a session
// is built out of changes. Same precedent as `launch-directive-calls.js` and
// `launch-directive-wire.js`.
//
// The containment argument came with it and is stated on `spawn` itself, where the code it governs
// is — that block is the whole §6 answer for this lane and must never be summarized into a pointer.
// What stayed behind is the THREAT MODEL (why the arming switch is local, why the row is not the
// authorization).
//
// `deps` IS INJECTED, NOT SHARED: the watcher owns the two handles this needs and hands them in per
// call, so this module holds no module state and its suite can drive it without arming a watcher.

const channelPrefs = require('./channel-prefs');
const channelRuntime = require('./channel-runtime'); // 2026-08-31: which runtime this channel's agents run on
const wire = require('./launch-directive-wire');
const sessionModel = require('./session-model');
// ⚠ THE POSTURE BOUND (2026-09-01, T24), SHARED WITH THE `set_agent_mode` KIND and pure. A
// directive may now ASK for a start posture and for chaining; `resolveLaunch` is where the asking
// is clamped to the operator's own stored channel pair, and its header carries why the ticket's
// own "unless the caller is the operator" carve-out is the whole set.
const launchPosture = require('./launch-posture');
const { diag } = require('./diag');

/**
 * SPAWN, THROUGH THE ORDINARY FUNNEL. Returns `{ refused: <word> }`, or — on success —
 * `{ agentId, appliedTools, appliedMessages, appliedChain }`, the ECHO the decide reports back
 * (2026-09-01). The three `applied*` values are the RESOLVED ones, never the requested ones.
 *
 * EVERY CONTAINMENT INPUT COMES FROM THIS MACHINE, NOT FROM THE DIRECTIVE. Stated field by field
 * because this is the whole safety argument:
 *   toolProfile   `channel-listener.js › watchedChannel` — MAIN's own full server DTO off the loop
 *                 entry, the same read `sessions:launch` makes (F-267) and `trigger.js` makes on
 *                 the responder lane. Unwatched -> refuse. Since 2026-09-02 (ruling B7) it is then
 *                 NARROWED, never widened: a launch into a SHARED container resolves `full` to
 *                 `channel_agent` — `full` minus the shell — because an agent with a shell and its
 *                 own bearer reaches the REST API directly. The fact comes from this machine's own
 *                 roster memo, never the row.
 *   startModes    the operator's DURABLE per-channel posture (`channel-prefs.js ›
 *                 getLaunchPosture`) as the CEILING, message axis floored at `auto_inbound` for the
 *                 windowless reason. Since T24 a directive may ASK for a NARROWER pair, and
 *                 `launch-posture.js › resolveLaunch` is the clamp: asking is admitted, widening is
 *                 not, and the ceiling is still the operator's own record.
 *   windowless    literal `true`. There is one spawn shape.
 * The directive supplies `goal`, `model`, an IDENTITY ID and — since T24 — a posture REQUEST and a
 * chaining REQUEST. None reaches a permission decision unclamped, and a chain asked for where the
 * channel forbids it REFUSES rather than launching quietly narrower.
 *
 * THE IDENTITY IS RESOLVED HERE AND ONLY HERE (2026-08-23). The row carries an ID and a NAME
 * SNAPSHOT; the CONTENT is fetched by THIS machine at claim time (`identity-resolve.js ›
 * resolveAgentIdentity`). Three deliberate consequences: the SECOND FENCE IS THE OPERATOR'S (the
 * orchestrator proved it could SEE the identity, this proves the operator can — a `team` identity
 * the operator is not in is created fine and refused here as `no-identity`, fail-closed and
 * designed); `knowledgeBases` is VIEWER-FILTERED against whoever resolves, so a shared identity
 * cannot launder access to a private base; and REFUSE, NEVER DEGRADE, because a blank agent wearing
 * no identity goes unnoticed.
 *
 * NO FIRST-USE APPROVAL ON THIS LANE — a ruling, not an omission (OQ-3). The button lane's one-modal
 * gate has no equivalent here: there is no human at the keyboard and the toggle already stands in
 * for the click, so `identity-approval` has no producer here and is not in the wire vocabulary.
 *
 * `operatorArmed: true`, AND IT IS THE TOGGLE THAT EARNS IT. `startSession`'s FIX-4 guard refuses a
 * handed-in posture on a `parkedShell` unless a human armed it just now; here that human is the
 * operator who turned this lane on, on this machine. Without it the spawn would drop the operator's
 * own posture and inherit the reducer's `manual` tool axis — not "safer", just the operator's
 * configured channel behaving differently depending on who pressed.
 *
 * `idle: !d.goal` — A GOAL RUNS, NO GOAL STANDS BY (2026-08-31; ENGINEERING §8 has the repro). It
 * was `idle: true` unconditionally, with the goal held for a WAKE; every link worked but the
 * PREMISE did not — the only caller of this lane cannot produce that wake, since a dormant session
 * is woken by an ADDRESS and a directive is filed by an AGENT, whose unaddressed posts
 * `session-dispatch.js › mayWake` refuses. The FENCE did not move and must not; the SPAWN SHAPE
 * did. `buildFencedTurn` fences the goal on both branches, and only the WHEN differs.
 */
/**
 * **WHICH RUNTIME THIS DIRECTIVE RUNS ON — AND THE ONE PLACE AN EXPLICIT ASK IS REFUSED RATHER
 * THAN SWAPPED** (2026-09-21, U9).
 *
 * 🔒 **THE DEFECT, VERBATIM FROM THE PLAN**: *a live MCP launch carrying `model: "codex"` was
 * accepted but started a Claude Sonnet agent, because the MCP contract has no runtime field and
 * an unknown model falls through to the default adapter.* Both halves were real, and this
 * function is the second half's answer.
 *
 * ── THE PRECEDENCE, AND WHY IT IS NOT SYMMETRIC ──────────────────────────────────────────────
 *   1. THE DIRECTIVE'S OWN `runtime` — an EXPLICIT ask. Honoured, or REFUSED. Never swapped.
 *   2. THE CHANNEL'S stored runtime (`channel-runtime.js › getChannelRuntime`) — the inherited
 *      default this lane has always used, unchanged.
 *   3. THE REGISTRY DEFAULT (`main/runtime/index.js › DEFAULT_ID`, the first registered).
 * Links 2 and 3 FAIL OPEN, exactly as they did before this wave: an absent or unknown channel
 * pick reads as "no pick" and the default adapter runs. Link 1 FAILS CLOSED. **That asymmetry IS
 * the ticket**: a stored channel pick from a build that knew an adapter this one does not must
 * not strand the room, while a request somebody just made must not quietly become another vendor.
 *
 * ⚠ **THE MEMBERSHIP TEST IS `ids()` AND IT MUST COME BEFORE `acquire()`, WHICH IS THE ONE TRAP
 * HERE.** `runtime/index.js › resolve` FAILS OPEN to the default for an unknown id — correct for
 * a stored session record, and exactly wrong for a live request — so `acquire('nonsense')`
 * SUCCEEDS by acquiring Claude. Asking the registry for its `ids()` first is what makes the
 * refusal real. **Do not reorder these two.**
 *
 * ⚠ **AND THE SECOND CHECK IS A REAL ONE, NOT BELT AND BRACES.** `acquire` runs the adapter's own
 * `available()` gate, so "registered but not installed / not signed in" is refused HERE with the
 * runtime NAMED in the diag, instead of reaching `session-launch.js` and coming back as the
 * anonymous `no-sdk` that means "this machine has no agent runtime" on every runtime.
 *
 * ⚠ **`no-sdk` RATHER THAN AN ELEVENTH REFUSAL WORD**, deliberately. The vocabulary is CLOSED on
 * the wire in four places (this tree's `REFUSAL_REASONS`, `schema-launch-modes.ts`, the column
 * CHECK, and the MCP `RETRY_ADVICE` map), and `no-sdk` already means precisely *"there is no such
 * agent runtime on this Mac"* — which is the true statement in both arms below. Its retry advice
 * is already `no`, which is also right: nothing the caller does changes the answer.
 *
 * ⚠ **THE REGISTRY IS LAZY-REQUIRED**, the idiom this lane already uses for `./targeting` and
 * `./identity-resolve`: `main/runtime/index.js` registers three adapters at load and the suites
 * evaluate this module against stubbed leaves.
 */
async function resolveRuntime(requested, channelId) {
  const registry = require('./runtime');
  const asked = typeof requested === 'string' ? requested.trim() : '';
  if (asked) {
    // ⚠ MEMBERSHIP FIRST — see the docblock. `ids()` is the ONLY enumeration of what this build
    // ships, and a second copy anywhere is the drift the registry exists to prevent.
    if (registry.ids().indexOf(asked) === -1) {
      diag('launch-directive: the directive asked for runtime', asked,
        '— this build has no such adapter registered (' + registry.ids().join(', ') + ');'
        + ' REFUSING rather than launching another vendor');
      return { refused: 'no-sdk' };
    }
    try {
      await registry.acquire(asked);
    } catch (err) {
      diag('launch-directive: runtime', asked, 'is registered but NOT usable here —',
        (err && err.message) || String(err), '— REFUSING rather than falling back');
      return { refused: 'no-sdk' };
    }
    return { id: asked, explicit: true };
  }
  // ⚠ THE INHERITED CHAIN, UNCHANGED FROM BEFORE U9. `getChannelRuntime` already normalizes
  // against the same registry and answers `''` for "no pick", which `session-launch.js` reads as
  // the default adapter — so `''` is passed on rather than being resolved to a literal here.
  const channel = channelRuntime.getChannelRuntime(channelId);
  return { id: channel, explicit: false };
}

/**
 * **THE ID THIS LANE REPORTS AS `appliedRuntime`** — the resolved pick spelled out.
 *
 * ⚠ `''` MEANS THE DEFAULT ADAPTER AND MUST BE REPORTED AS ITS NAME, NOT AS SILENCE. `null` on
 * the column means NOT REPORTED (an older desktop), and an orchestrator reading that word beside
 * a successful launch learns nothing. The registry is the only thing that can name the default.
 */
function appliedRuntimeId(id) {
  if (id) return id;
  try { return require('./runtime').DEFAULT_ID || ''; } catch (_err) { return ''; }
}

/**
 * **THE MODEL, RESOLVED INSIDE THE RUNTIME THAT WILL ACTUALLY RUN IT** (2026-09-21, U9).
 *
 * ⚠ **THE OLD CHAIN WAS CLAUDE'S, ON EVERY RUNTIME, AND THAT IS HALF THE ORIGINAL DEFECT.**
 * `sessionModel.chainModel` / `aliasForModelId` resolve against `session-model.js`'s FROZEN
 * CLAUDE TABLE, so on a Codex launch the directive's own `codex` id collapsed to `''` ("no
 * opinion") and the chain fell through to the IDENTITY's and then the CHANNEL's model — both
 * Claude ids — which were then handed to a non-Claude adapter.
 *
 * ⚠ **SO THE CHAIN IS NOW SCOPED TO THE DEFAULT (CLAUDE) ADAPTER, AND EVERY OTHER RUNTIME GETS
 * ITS OWN ROSTER OR NOTHING.** `''` is not a degradation: it is `descriptor.models
 * .defaultMeansAbsent`, the convention the whole precedence chain rests on — no model argument at
 * all, i.e. that platform's own default — which is the only correct answer once a cross-vendor id
 * has been refused.
 *
 * ⚠ **THE ROSTER IS ASKED ONLY WHEN THERE IS A QUESTION TO ANSWER** — a non-default runtime AND a
 * requested model. `runtime.models()` on a live-roster adapter spawns a process, so asking it on
 * every launch would put a Codex app-server in the path of every Claude launch. It is also
 * allowed to FAIL: an unreachable roster answers "drop the model", never "guess", and never
 * another runtime's list (the plan's R11 — catalog failure must not substitute a vendor).
 *
 * ⚠ **IT REJECTS, IT NEVER RE-ROUTES.** A Claude model named on a Codex launch changes NOTHING
 * about the runtime — the session still starts on Codex, on Codex's own default model, and the
 * drop is named in the diag and in the `model=` / `appliedModel=` pair the MCP result prints.
 */
/** The model id the launch actually resolved to — `runtime.modelArg`'s answer where there is one. */
function appliedModelId(runtimeId, modelArg) {
  try {
    const rt = require('./runtime').runtimeFor(runtimeId);
    if (rt && typeof rt.modelArg === 'function') {
      const r = rt.modelArg(modelArg || '');
      if (r && r.ok && r.id) return r.id;
    }
  } catch (_err) { /* fall through to what this lane applied */ }
  return modelArg || '';
}

async function resolveModel(runtimeId, d, identity) {
  const registry = require('./runtime');
  let defaultId = '';
  try { defaultId = registry.DEFAULT_ID || ''; } catch (_err) { defaultId = ''; }
  // ⚠ THE DEFAULT ADAPTER KEEPS THE EXISTING CHAIN, BYTE FOR BYTE (spec §3c):
  //   directive.model > identity.model > channelPrefs.getLaunchModel > SDK default
  // Every link is `chainModel` — "a real pick, or '' meaning KEEP GOING" — INCLUDING the
  // directive's own (F-285). ⚠ SINCE 2026-09-22 AN UNRECOGNISED ID NO LONGER FALLS THROUGH: it
  // commits the chain and the funnel REFUSES it (`no-model`), because falling through is how an
  // unknown id started the product default while the launch echoed the id it was asked for.
  if (!runtimeId || runtimeId === defaultId) {
    // ⚠ `getLaunchModelLink`, NOT `aliasForModelId(getLaunchModel(...))` (U5, 2026-09-21). The
    // channel's stored model is now RUNTIME-KEYED (`launch-selection.js › byRuntime`), and the old
    // pair read the DEFAULT runtime's record through Claude's alias table — so a channel whose
    // stored pick belongs to another runtime silently contributed nothing to this chain. The link
    // form resolves the pick on ITS OWN runtime and still answers `''` for "keep going", which is
    // what every other link in this expression means.
    return sessionModel.chainModel(d.model)
      || require('./session-launch-op').identityModel(sessionModel, identity)
      || channelPrefs.getLaunchModelLink(d.channelId);
  }
  const asked = typeof d.model === 'string' ? d.model.trim() : '';
  if (!asked) return '';
  let roster = null;
  try {
    roster = await registry.runtimeFor(runtimeId).models();
  } catch (err) {
    diag('launch-directive: could not read', runtimeId, "'s model roster —",
      (err && err.message) || String(err), '— launching on that runtime\'s own default model');
    return '';
  }
  const ids = (roster && Array.isArray(roster.ids) ? roster.ids : []);
  if (ids.indexOf(asked) !== -1) return asked;
  // ⚠ **NOT DROPPED ANY MORE (2026-09-22) — HANDED ON, SO THE FUNNEL REFUSES IT WITH A SENTENCE.**
  // A roster that ANSWERED and lacks the id is a definitive "this runtime does not offer that
  // model", and launching on the platform default anyway is the silent substitution this wave
  // removes. `session-launch.js › refuseUnknownModel` answers `no-model`. An UNREADABLE roster
  // (the catch above) still drops: that is "Dopl could not check", not "it does not exist".
  // ⚠ The runtime is still NOT changed: a model never selects a vendor.
  diag('launch-directive: model', asked, 'is not in', runtimeId, "'s roster — the launch will be refused (no-model)");
  return asked;
}

async function spawn(d, deps) {
  // ⚠ **ANSWERED BEFORE ANY WORK, BESIDE THE CHAIN REFUSAL BELOW**, and for the same reason: an
  // explicit runtime this machine cannot run is a REFUSAL, and a refusal that costs an identity
  // fetch and a spawn attempt first is a refusal the operator pays for.
  const runtime = await resolveRuntime(d.runtime, d.channelId);
  if (runtime.refused) return { refused: runtime.refused };
  const plan = launchPosture.resolveLaunch({
    requested: { tools: d.startToolMode, messages: d.startMessageMode },
    ceiling: channelPrefs.getLaunchPosture(d.channelId),
    chainRequested: d.chain,
    chainAllowed: channelPrefs.getAgentChain(d.channelId),
    floorMessages: (m) => channelPrefs.windowlessMessageMode(d.channelId, m),
    toolOrder: wire.TOOL_MODES, messageOrder: wire.MESSAGE_MODES,
  });
  // ⚠ ANSWERED BEFORE ANY WORK, because the chain request REFUSES where the posture CLAMPS —
  // `launch-posture.js › resolveChain` carries both halves of that asymmetry.
  if (plan.refused) {
    // `no-chain`, NOT `no-bridge` (2026-09-02): the two facts are opposite instructions —
    // `no-bridge` means this machine has no context for that channel, while this means the channel
    // is right and ONE SETTING is off. The setting's name travels in the log AND on the wire,
    // because a refusal an orchestrator can only explain by reading this repo is what T24 deletes.
    diag('launch-directive: chaining asked for and NOT enabled here —', launchPosture.CHAIN_SETTING,
      'is off for this channel; the operator turns it on in the channel Settings tab');
    return { refused: 'no-chain', setting: launchPosture.CHAIN_SETTING };
  }
  if (plan.clamped) {
    diag('launch-directive: posture CLAMPED to this channel\'s stored pair — asked',
      String(d.startToolMode || '-') + '/' + String(d.startMessageMode || '-'),
      'applied', plan.modes.tools + '/' + plan.modes.messages);
  }
  const channel = deps.watchedChannel ? deps.watchedChannel(d.channelId) : null;
  if (!channel) {
    // NOT WATCHING THIS CHANNEL IS A REFUSAL, NOT A CRASH, and `no-bridge` is the honest word: this
    // machine has no context for that channel, so it has nothing to launch INTO. Failing closed here
    // also stops a directive naming an arbitrary channel id from reaching a spawn with a
    // fail-closed `read_only` profile and looking like it worked.
    return { refused: 'no-bridge' };
  }
  const targeting = require('./targeting');
  const channelLevel = d.taskId === '';

  // ── THE IDENTITY, UNDER THIS OPERATOR'S CREDENTIAL ─────────────────────────────────────
  // ⚠ AFTER the watched-channel lookup and BEFORE `deps.launch` — the order IS the containment
  // statement: the tool profile is already decided by the time any identity text exists here.
  let identity = null;
  if (d.identityId) {
    const resolved = await require('./identity-resolve').resolveAgentIdentity(d.identityId, d.workspaceId);
    // `resolved.reason` is already one of the wire words — `no-identity` for a 404 (deleted,
    // invisible to THIS operator, or IN ANOTHER TENANCY: `d.workspaceId` is the CHANNEL's container,
    // so an identity this operator owns elsewhere is ABSENT from that read), `busy` for a timeout,
    // network failure or 5xx. 404-never-403 makes the first two one answer and this machine must not
    // try to tell them apart. Passed through rather than re-mapped: `decideBody › refusalFor` is the
    // closed-vocabulary gate.
    if (!resolved.ok) return { refused: resolved.reason };
    identity = resolved.identity;
  } else if (d.identityName) {
    // E-4 — THE DELETION SIGNAL, AND IT REFUSES WITHOUT A RESOLVE ATTEMPT. `identity_id` is
    // `ON DELETE SET NULL`, so an identity deleted between CREATE and CLAIM leaves the id null and
    // the NAME standing — which is why the server snapshots the name, since on the id alone this
    // machine cannot tell "no identity requested" from "identity deleted".
    diag('launch-directive: identity deleted before claim —', String(d.identityName).slice(0, 40));
    return { refused: 'no-identity' };
  }

  // ⚠ **RESOLVED BEFORE THE MODEL, BECAUSE THE MODEL IS RESOLVED INSIDE IT** (U9). The old order
  // had no such dependency — there was one model table and it was Claude's.
  const modelArg = await resolveModel(runtime.id, d, identity);
  const res = await deps.launch({
    channelId: d.channelId,
    taskId: d.taskId,
    workspaceId: d.workspaceId || null,
    // ── THE RUNTIME (2026-08-31, port wave D; the DIRECTIVE'S OWN ask added 2026-09-21, U9) ──
    //
    // THE CHANNEL'S RUNTIME, INHERITED — `trigger.js › launchResponderSession` carries the
    // argument for why this record travels where the permission pair may not. A directive lane
    // has no human at the keyboard, so it inherits the channel's setting exactly as it inherits
    // the tool profile. Absent => the default.
    // ⚠ **AND SINCE U9 A DIRECTIVE MAY NAME ONE ITSELF, WHICH OVERRIDES THE CHANNEL AND IS
    // REFUSED RATHER THAN SWAPPED WHEN THIS MACHINE CANNOT RUN IT.** `resolveRuntime` above is
    // the whole rule, including why link 1 fails CLOSED while links 2 and 3 fail OPEN.
    runtime: runtime.id,
    goal: d.goal || defaultGoal(channelLevel),
    counterpartyId: null,
    direct: false,
    context: {
      channelName: String(channel.name || '').slice(0, 120),
      taskTitle: null,
      channelId: d.channelId,
      workspaceId: d.workspaceId || null,
      taskId: d.taskId,
      scope: channelLevel ? 'channel' : 'thread',
      workspaceSegment: null,
      // THE RESOLVED IDENTITY, CAPTURED AT SPAWN AND NEVER RE-READ. The SAME `context.identity` key
      // the button lane uses, so this costs zero funnel changes: one resolution point, two lanes,
      // one consumer (`prompt-framing-agent-identity.js › identityRoleFraming`). A session keeping its
      // spawn-time identity content FALLS OUT rather than being enforced — the role block is built
      // at WAKE from what was captured here, so an identity edited or deleted afterwards neither
      // changes nor stops this session (E-1 / E-2). `null` when none was named.
      identity,
    },
    // THE CHANNEL'S PROFILE, NARROWED FOR A SHARED ROOM (2026-09-02, ruling B7). The READ is
    // unchanged and is still MAIN's own full server DTO; what is new is one NARROWING, which can
    // only ever move `full` -> `channel_agent`. ONE CALL, and the other two launch lanes make the
    // same one — the rule used to be spelled beside this resolver alone, so the New Agent button and
    // the responder trigger kept their shell in a room this lane bounded (F-510). THE DIRECTIVE
    // STILL SUPPLIES NOTHING HERE: a profile has never been a directive field and does not become
    // one — this is the DESTINATION's property, read on this machine.
    toolProfile: targeting.resolveLaunchToolProfile(channel),
    mode: 'interactive',
    windowless: true,
    startModes: plan.modes, // T24: the operator's stored pair, or a narrower one the directive asked for
    // ── ⚠ THE MODEL, RESOLVED INSIDE THE RESOLVED RUNTIME (U9; spec §3c for the Claude chain) ──
    // `resolveModel` above holds the whole rule and the reason it is now runtime-scoped: the old
    // chain was Claude's on EVERY runtime, so a Codex launch fell through the directive's own
    // `codex` id and handed a CLAUDE model to a non-Claude adapter.
    model: modelArg,
    // THE COLOUR THE ORCHESTRATOR ASKED FOR (Samuel, 2026-09-13; docs/specs/agent-colors.md).
    // `dopl_channel(op="manage", action="launch", color=…)` reaches this lane as a directive column
    // and nowhere else — a parameter the server accepts and the spawning machine cannot see would be
    // worse than no parameter. NO PRECEDENCE CHAIN, unlike `model` above, and the asymmetry is the
    // point: a colour is UNIQUE among a channel's live agents across EVERY member, so a remembered
    // default is a default that collides the second time it is used. Empty means "the server picks
    // the first free key". What arrives here may already be STALE by design — the 409 at create time
    // is a courtesy, never a reservation — so this lane APPLIES it and never verifies it.
    color: d.color,
    launchChain: plan.chain, idle: !d.goal, // ⚠ `launchChain` (2026-08-31, Samuel's agent-chaining ruling): THIS lane is the ONLY caller that passes it, read PER DIRECTIVE and never cached (the operator may flip the channel setting between two of them), so a session started here may launch further agents exactly when the room says so — every other lane passes nothing, reads false, and keeps the one-generation bound. ⚠ `idle`: docblock; `directiveFrom` trimmed the goal, so '' is the only spelling of "none"
    operatorArmed: true, // ⚠ both branches: FIX-4 reads it only for a shell, but it is true either way
  });
  // THE ECHO, RETURNED BESIDE THE ADDRESS (2026-09-01, T24's second half). `decideBody` puts these
  // three on the LAUNCHED body and the server stores them in `applied_tool_mode` /
  // `applied_message_mode` / `applied_chain`.
  //
  // They are `plan`'s values, NEVER `d`'s: `d.*` is what the ORCHESTRATOR ASKED FOR, `plan.*` is
  // what this machine SETTLED ON after the clamp, the windowless floor and the chain rule — the same
  // objects handed to `deps.launch`, so the report cannot drift from the session. REPORTED ON EVERY
  // LAUNCH, not only a clamped one, so that "not reported" keeps meaning "this machine said
  // nothing" (an older desktop) rather than becoming ambiguous.
  if (res && res.agentId) {
    // THE NAME (Samuel, 2026-09-15: agents spinning up agents should be the ones naming them, and
    // never with the id as the name).
    //
    // AFTER the launch, not before, because the name is keyed on the AGENT ID and there is no id
    // until `deps.launch` answers. `agent-names.js` is keyed by the INSTANCE address, which is why a
    // rename survives a park, a lazy resume and a crash resume. `New Agent` is the fallback for a
    // directive with no name (a client older than `20261006120000`, §13's supported peer). Through
    // `commitRename`, never `agent-names.js` directly: that wrapper also touches the summary, and a
    // name that never reaches the projection is a name the @-picker and every peer's card do not
    // have. A refusal is NOT a failed launch. The STORED name is reported back, because it may not
    // be the one asked for (the uniqueness rule may have stored `Coder-1`).
    // ⚠ **THE `try` WRAPS THE COMMIT AND NOTHING ELSE (F-736, 2026-09-18).** It used to enclose
    // the diagnostics as well, so a throw from a `diag` AFTER a successful `commitRename` landed
    // in the catch with `applied` still null — and this machine then reported "no name" for an
    // agent it had just named. The report is the half an orchestrator addresses by, so losing it
    // to a logging failure is a mis-delivery bought with a log line. Everything that can throw
    // is inside; everything that reads the answer is outside.
    let stored = null;
    try {
      // THE FALLBACK IS LOGGED, because a nameless agent used to be indistinguishable from a named
      // one here (F-708, 2026-09-16). `'' -> New Agent` is the older-client arm and is legitimate,
      // but it is ALSO what a NAME LOST UPSTREAM looks like — and that is what had happened: the API
      // route dropped `agentName` before the row was written, so this line ran the fallback on every
      // launch and said nothing. The name the directive carried separates the two.
      const asked = d.agentName || '';
      if (!asked) {
        diag('launch-directive: directive carried NO agent name — falling back to',
          NEW_AGENT_NAME, '(an older client sends none; a NEWER one that asked for a name and'
          + ' landed here has lost it upstream of this machine)');
      }
      stored = require('./agent-identity-commit')
        .commitRename(res.agentId, asked || NEW_AGENT_NAME);
    } catch (err) {
      diag('launch-directive: could not store the agent name —', err && err.message);
    }
    const applied = stored && stored.ok ? stored.name : null;
    // THE REFUSAL ARM, WHICH LOGGED NOTHING AT ALL. `commitRename` answers
    // `agent-self-ops.js › applyRenameTo`'s verdict, and a sanitizer refusal is `ok: false` — so
    // an agent could run unnamed with no line anywhere, and `appliedAgentName` goes back as null.
    // ⚠ `channel-ops-launch.ts` renders that null as `(not reported)` since F-736 closed; it used
    // to ECHO THE REQUEST, so the launcher read the name it asked for while the machine stored
    // none. Still not a failed launch — a line, not a verdict.
    if (!applied) {
      diag('launch-directive: the agent name was REFUSED by the store —',
        (stored && stored.reason) || 'no reason given',
        '— agent', res.agentId, 'is running UNNAMED');
    }
    return {
      agentId: res.agentId,
      appliedTools: plan.modes.tools,
      appliedMessages: plan.modes.messages,
      appliedChain: plan.chain,
      appliedAgentName: applied,
      // ⚠ **WHICH RUNTIME AND MODEL THIS LANE SETTLED ON** (2026-09-21, U9) — `runtime`'s and
      // `modelArg`'s values, NEVER `d.runtime` / `d.model`, on the echo trio's own rule directly
      // above: `d.*` is what the ORCHESTRATOR ASKED FOR and these are what this machine RESOLVED,
      // and they are the SAME objects handed to `deps.launch` one screen up, so the report cannot
      // drift from the launch. REPORTED ON EVERY LAUNCH, including one that asked for nothing,
      // so that "not reported" keeps meaning "this machine said nothing" (an older desktop).
      // ⚠ `appliedRuntimeId('')` NAMES THE DEFAULT ADAPTER rather than reporting silence — the
      // whole value of the field is that an orchestrator stops having to assume which vendor ran.
      // ⚠ **THE MODEL IS THE ONE THE ADAPTER RESOLVED IT TO (2026-09-22)**, off the same live
      // roster the launch spec spends (`runtime.modelArg`, where an adapter offers one): an absent
      // pick reports the product fallback's real id rather than silence, and a legacy alias
      // reports the model it named. An adapter with no resolver reports what this lane applied.
      // (The old "KNOWN GAP" note here is closed: U5 moved the engine's coercion behind the
      // adapter, and an unknown id is refused before this point — `no-model`.)
      appliedRuntime: appliedRuntimeId(runtime.id),
      appliedModel: appliedModelId(runtime.id, modelArg),
    };
  }
  return { refused: wire.refusalFor(res && res.skipped) };
}

/**
 * THE FACE AN UNNAMED AGENT WEARS (Samuel, 2026-09-15: an agent launched with no name is called
 * `New Agent`) — HAND-COPIED from `src/shared/lib/agent-name.ts › NEW_AGENT_NAME`, which main
 * cannot import. Its only reader here is the directive lane's older-client arm.
 */
const NEW_AGENT_NAME = 'New Agent';

/** The goal a directive with none falls back to — the same sentence the New Agent button
 *  composes, because a directive with no goal is asking for exactly that agent. */
function defaultGoal(channelLevel) {
  return channelLevel
    ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
    : 'Join this thread as my agent: read it with dopl_channel (op "read", thread=<id>) and carry the work forward.';
}

module.exports = { spawn, defaultGoal };
