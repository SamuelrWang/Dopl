import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import { AGENT_COLOR_KEYS } from "./lib/agent-colors";
import type {
  AgentColorKey,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "./types";

/**
 * LAUNCH-OVER-MCP's route schemas — the CREATE (an operator's agent asking) and
 * the DESKTOP LANE (claim / decide).
 *
 * ⚠ **NO SCHEMA IN THIS FILE HAS AN `operatorUserId` FIELD, AND NONE MAY EVER
 * GET ONE.** A directive names the machine it will run on, and the only machine
 * an agent may ask to start something is its own operator's. The id is stamped
 * from the authenticated context in `server/service-launch.ts`; a field here
 * would be a way to name somebody else's computer.
 */

/**
 * THE TWO PERMISSION AXES, **DECLARED ONCE IN THIS FILE AND EXPORTED** —
 * ORDERED NARROWEST FIRST (2026-09-01, T24).
 *
 * ⚠ **THE ORDER IS THE CONTRACT, AND NO COMPILER CHECKS IT.** `closedEnum` proves
 * these arrays are the same SET as {@link LaunchToolMode} / {@link
 * LaunchMessageMode}; it says nothing about the SEQUENCE. The clamp on the other
 * side of the wire is an INDEX COMPARISON over the desktop's own copies
 * (`dopl-desktop-app/main/launch-posture.js › narrowTo`, over
 * `main/launch-directive-wire.js › TOOL_MODES` / `MESSAGE_MODES`), so re-ordering
 * either array silently INVERTS the bound with every test still green.
 *
 * ⚠ **THREE STATEMENTS OF EACH SET, AND ONLY ONE PAIR IS COMPILER-CHECKED** —
 * exactly the caveat {@link LaunchRefusalReasonSchema} carries. Here and
 * `types-launch.ts` are held together by `closedEnum`; the third is
 * `20260910120000_channel_launch_directives_posture.sql`'s value CHECKs, which no
 * TypeScript can reach. A fifth mode is a schema change in all three, in one
 * wave, or a request carrying it passes zod, passes the route and is refused AT
 * REST.
 *
 * ⚠ EXPORTED because the MCP surface publishes the same two enums to its callers
 * and a second literal there is the drift this declaration exists to prevent.
 */
// ⚠ **THE TWO MODE ARRAYS MOVED TO `schema-launch-modes.ts` (§1 SPLIT, 2026-09-15)** — a LEAF,
// so this file and `schema-launch-decide.ts` can both read them without a module-eval cycle (that
// file's header carries the measurement). ⚠ RE-EXPORTED, so every existing importer is unchanged,
// and the NARROWEST-FIRST order is documented there beside the arrays the clamp indexes into.
export {
  LAUNCH_MESSAGE_MODES,
  LAUNCH_TOOL_MODES,
} from "./schema-launch-modes";
import {
  LAUNCH_MESSAGE_MODES,
  LAUNCH_TOOL_MODES,
  LAUNCH_REFUSAL_REASONS,
  LAUNCH_RUNTIME_ID_MESSAGE,
  LAUNCH_RUNTIME_ID_RE,
} from "./schema-launch-modes";

const ToolModeSchema = closedEnum<LaunchToolMode>()(LAUNCH_TOOL_MODES);
const MessageModeSchema = closedEnum<LaunchMessageMode>()(LAUNCH_MESSAGE_MODES);

// ── ⚠ **`ChannelAgentPostureSchema` AND `ChannelAgentPostureInput` ARE DELETED**
// (2026-09-06, Samuel's rulings on items 12, 13 and 14) ──────────────────────────────────────
//
// They validated THE CHANNEL'S POSTURE CEILING — the three `channels.agent_*` columns a room
// MANAGER set over EVERY member's agents — edited through the ordinary channel PATCH and
// manage-gated there. The whole record is gone: the columns are unread, the field is off
// `MANAGED_CHANNEL_FIELDS`, and `service-launch-posture.ts` no longer clamps or refuses.
//
// ⚠ **THE TWO ORDERED ENUMS ABOVE STAY, AND THE DIFFERENCE MATTERS.** This schema reused
// `LAUNCH_TOOL_MODES` / `LAUNCH_MESSAGE_MODES` rather than restating them because the CEILING
// and the REQUEST had to agree about what "wider" means — the clamp's comparison was an INDEX
// into those arrays. That coupling reason is dead with the clamp. **The ORDER is not**: the
// arrays are still ordered narrowest-first, `LaunchCreateSchema` below still validates a
// request against them, and `dopl-desktop-app/main/launch-posture.js` still clamps the
// operator's own posture by index on its own side. Do not "simplify" either array to an
// unordered set on the grounds that nothing compares them any more — one thing still does, and
// it is in the other tree where this file's reader cannot see it.
//
// ⚠ The `null`-is-the-clear rule this block used to state was rehomed on
// `ChannelUpdateSchema.defaultResponderAgentName` — and THAT field is deleted too (2026-09-07,
// items 10 and 11), so the rule now has no channel-agent field left to govern. It survives on
// `infoCard` and `archived`, where `undefined` still means "not in this patch". ⚠ Its successor
// setting deliberately has NO clear: `channel_members.unaddressed_responder` is `NOT NULL` with
// two values, and `'last_addressed'` IS the unconfigured answer, so a nullable spelling there
// would mint the third state the migration refused.

export const LaunchCreateSchema = z.object({
  /** Channel slug or id. ⚠ Not `.uuid()` — a slug is a legal ref everywhere else
   *  in this feature and the service resolves both. */
  channel: z.string().min(1).max(200),
  /** ⚠ `.uuid()`: only a FIRST-CLASS thread can carry an agent. A legacy
   *  `task-<channelId>-<seq>` id names no `channel_tasks` row, so accepting one
   *  would 404 in the service anyway — refusing it here names the field. */
  threadId: z.string().uuid().optional(),
  /** ⚠ Bounded at 2000, the same order as a thread's `summary`. It is the
   *  agent's opening instruction, not a deliverable — a 16000-char goal is a
   *  message that wanted to be a post. */
  goal: z.string().trim().min(1).max(2000).optional(),
  /** ⚠ `safeLabel`, not a `z.enum` over the four known ids. The effective model
   *  set is the DESKTOP's and it is free-form (`spa-bridge-shapes.ts` says so:
   *  "render it; do not match it against that list"), so an enum here would
   *  refuse a model a newer machine can run. Shape-bounded because it is
   *  rendered back into an MCP result. */
  model: safeLabel("Model", 120).optional(),
  /**
   * **WHICH RUNTIME THE NEW AGENT RUNS ON — A FIRST-CLASS FIELD, NEVER INFERRED FROM
   * {@link LaunchCreateSchema.model}** (2026-09-21, U9 of the Codex runtime-parity plan).
   *
   * 🔒 **THE BUG THIS CLOSES, VERBATIM FROM THE PLAN**: *a live MCP launch carrying
   * `model: "codex"` was accepted but started a Claude Sonnet agent, because the MCP contract
   * has no runtime field and an unknown model falls through to the default adapter.* Both halves
   * were real. There was no `runtime` anywhere on this lane, and `session-model.js ›
   * chainModel` answers `''` for an id it does not know — so `codex` was read as "no model
   * opinion", the chain fell through to the channel's Claude model, and the launch succeeded
   * while naming the wrong vendor.
   *
   * ⚠ **A MODEL NAME MUST NEVER DOUBLE AS A RUNTIME SELECTOR** (the plan's Decision #4), and the
   * rule has a direction on each side: this field never reads `model`, and `model` is never
   * consulted to pick an adapter. **A MISSING VALUE IS NEVER CODEX AND IS NEVER GUESSED.**
   *
   * ⚠ **OPTIONAL, AND OMITTING IT IS TODAY'S BEHAVIOUR BYTE FOR BYTE** — the documented default
   * chain, on the machine that owns it: the CHANNEL's stored runtime
   * (`main/channel-runtime.js › getChannelRuntime`), then the REGISTRY DEFAULT
   * (`main/runtime/index.js › DEFAULT_ID`, the first registered adapter). An older
   * `@dopl/mcp-server` in the field sends no such key and must keep working (INVARIANTS §13).
   *
   * ⚠ **AN EXPLICIT RUNTIME THAT IS UNAVAILABLE IS REFUSED, NEVER SUBSTITUTED.** The registry's
   * own `resolve()` FAILS OPEN to the default for an unknown id — right for a stored session
   * record written by a build that knew a runtime this one does not, and exactly wrong for a
   * request somebody just made — so the directive path refuses instead
   * (`main/launch-directive-spawn.js › resolveRuntime`, answering `no-sdk`). That asymmetry is
   * the whole point of the field.
   *
   * ⚠ **A SHAPE, NOT AN ENUM, AND {@link LAUNCH_RUNTIME_ID_RE} CARRIES THE ARGUMENT.** The
   * roster is the DESKTOP's registry and moves with a desktop release; a closed enum here would
   * refuse a runtime a newer machine ships. Membership is decided by the machine, which is also
   * the only party that can say whether the runtime would actually start.
   */
  runtime: z
    .string()
    .trim()
    .regex(LAUNCH_RUNTIME_ID_RE, LAUNCH_RUNTIME_ID_MESSAGE)
    .optional(),
  /**
   * THE AGENT IDENTITY TO RUN AS — **an id OR an exact name** (2026-08-23).
   *
   * ⚠ ONE PARAM FOR BOTH, which is this tree's own idiom rather than a new
   * convention: `dopl_kb`'s `base` already takes either
   * (`knowledge-shared.ts › resolveBase`). The service disambiguates on shape —
   * UUID ⇒ id, otherwise a case-insensitive EXACT name over the caller-visible
   * set — and **refuses, listing every match, when a name is ambiguous.**
   * `agent_identities` has no name uniqueness on purpose (a unique index across a
   * visibility boundary leaks the existence of a private row through a conflict
   * error), so ambiguity is a legitimate state and every "pick one" rule is
   * silently surprising.
   *
   * ⚠ `safeLabel`, matching `model` beside it and for the same reason: the ref is
   * echoed back in the not-found refusal an MCP result renders, so it is
   * shape-bounded before it can carry a newline into a line we wrote. 120 is
   * `agent_identities.name`'s own bound — a name that is legal on an identity must
   * never be refusable here, or a legitimate launch 400s.
   *
   * ⚠ NOT `.uuid()`, and never narrowed to one: refusing the NAME form here
   * would make an orchestrator carry ids it has no way to look up over this tool.
   */
  identity: safeLabel("Identity", 120).optional(),
  /**
   * THE POSTURE THIS LAUNCH **ASKS** ITS NEW SESSION TO START ON (T24).
   *
   * ⚠ **ASKS. NEVER WIDENS, AND OMITTING BOTH IS THE PRE-T24 BEHAVIOUR EXACTLY.**
   * The operator's machine CLAMPS each axis to that operator's own stored channel
   * posture (`main/launch-posture.js › resolvePosture`) and an absent axis
   * resolves to the ceiling itself. Nothing on this path enforces the clamp and
   * nothing can — the ceiling is an `electron-store` record no server sees — so
   * these two are a request, and the result copy has to say so.
   * ⚠ A `z.enum` rather than a label: the set is CLOSED on the wire, the column
   * CHECK says the same at rest, and a value outside it must be a 400 that NAMES
   * the field rather than a constraint violation surfacing as an opaque 500.
   */
  tools: ToolModeSchema.optional(),
  messages: MessageModeSchema.optional(),
  /**
   * MAY THE LAUNCHED AGENT LAUNCH FURTHER AGENTS?
   *
   * ⚠ **OPTIONAL, AND OMITTING IT IS NOT THE SAME AS `false`.** Omitted means "I
   * did not ask", which inherits the channel's own setting. Collapsing that into
   * a request would turn every ordinary launch into one — and a request the
   * channel denies is REFUSED, not clamped (`launch-posture.js › resolveChain`),
   * so the collapse would start refusing launches that asked for nothing.
   *
   * ⚠ **`false` DOES TURN CHAINING OFF, AND IT WINS OVER A CHANNEL SET TO ON**
   * (fixed 2026-09-01). It is strictly narrower than anything the operator's
   * setting would have granted, so there is nothing for that setting to protect
   * and `main/launch-posture.js › resolveChain` grants it unconditionally —
   * never a refusal, because NARROWING IS NEVER REFUSED.
   * ⚠ **THIS DOCBLOCK SAID THE OPPOSITE UNTIL 2026-09-01 AND THE PROSE WAS
   * HONEST AT THE TIME.** `main/launch-directive-wire.js › directiveFrom` read
   * `r.chain === true || r.chain === 'true' ? true : null`, so a stored `false`
   * fell down the `null` arm, arrived as "did not ask", and INHERITED the channel
   * setting — which may be ON. `launch-posture.js › resolveChain` had the
   * matching defect (its `false` arm fell through to `allowed === true`), and the
   * two hid each other precisely because each half was tested alone. Both are
   * fixed; `dopl-desktop-app/test/launch-chain.test.mjs` now drives the wire and
   * the resolver TOGETHER across all three states, which is the only shape of
   * test that could have caught it.
   * ⚠ **THE COLUMN STAYS A NULLABLE BOOLEAN AND THAT IS NOW LOAD-BEARING RATHER
   * THAN MERELY CHEAP.** All three values are distinct requests with distinct
   * outcomes; a `z.literal(true)` here would delete one of them.
   */
  chain: z.boolean().optional(),
  /**
   * **THE IDEMPOTENCY KEY — "a retry may not queue a SECOND agent"**
   * (2026-09-02, A10/G10).
   *
   * ⚠ **THE BOUNDS ARE `schema.ts › PostSchema.client_msg_id`'s, DELIBERATELY.**
   * One idempotency key shape across the whole feature: `.min(1)` because a blank
   * is not a key (and a caller that sent one would believe it deduped something),
   * 200 because that is what every `client_msg_id` column in this tree stores.
   * A second spelling here is how one lane silently accepts a key the other
   * refuses.
   * ⚠ OPTIONAL, AND OMITTING IT IS TODAY'S BEHAVIOUR EXACTLY — one row per call,
   * no probe, no convergence. The partial unique index dedupes nothing on NULL.
   * ⚠ IT IS NOT `.uuid()`: any stable string the caller owns is a key, and the
   * one worth minting is namespaced to the caller
   * (`20260911120000_launch_direction_client_msg_id.sql` scopes uniqueness to
   * `(channel_id, operator_user_id)`, so a collision with another member is not
   * expressible in the first place).
   */
  clientMsgId: z.string().min(1).max(200).optional(),
  /**
   * **THE COLOUR THE NEW AGENT SHOULD WEAR IN THIS CHANNEL** (2026-09-13,
   * `20261005120000`).
   *
   * ⚠ **OMITTING IT IS THE ORDINARY CASE AND MEANS "PICK FOR ME"** — the server takes
   * the FIRST FREE key (`lib/agent-colors.ts › firstFreeAgentColor`), which is what
   * every launch filed before this wave effectively did. It is NOT "no colour": an
   * agent with no colour is a room whose sixteen keys are all out, and that is a fact
   * about the room rather than a choice a caller can express.
   * ⚠ **A NAMED KEY THAT IS TAKEN IS A 409 WITH THE FREE SET**, never a silent
   * substitution — `server/errors.ts › AgentColorTakenError` argues why this lane
   * refuses where the push lane substitutes.
   * ⚠ A `closedEnum` over the sixteen, matching the two column CHECKs character for
   * character: the set is OURS (two CSS files), so a value outside it is a caller
   * error worth naming rather than a newer machine's vocabulary to tolerate.
   */
  color: closedEnum<AgentColorKey>()(AGENT_COLOR_KEYS).optional(),
  /**
   * **WHAT TO CALL THE NEW AGENT — REQUIRED, BECAUSE THE CALLER IS AN AGENT**
   * (Samuel, 2026-09-15, verbatim: *"if agents are spinning up agents, they should be the ones
   * that are naming the agent. Shouldn't be a nameless agent. And certainly shouldn't be an
   * agent with the id as the name."*).
   *
   * ⚠ **IT DID NOT EXIST AT ALL UNTIL THIS WAVE, WHICH IS THE WHOLE DEFECT.** There was no way
   * for an agent-filed launch to carry a name, so every agent an agent launched was nameless by
   * construction and rendered as its own instance id on every card. Adding the field and making
   * it REQUIRED are one change: an optional one would have left the defect reachable by omission,
   * and the caller here is a model that will omit whatever it can.
   *
   * ⚠ **REQUIRED HERE AND ONLY HERE — a HUMAN launch is a different lane and stays optional.**
   * The dialog opens blank and a blank submit is named `New Agent`
   * (`components/use-agent-launch-run.ts`), because a person who left the field alone has said
   * something; an agent that omitted a required argument has said nothing. Different actors,
   * different defaults, one face.
   *
   * ⚠ **60, NOT 120**, matching {@link AgentDirectiveCreateSchema}'s rename arm and
   * `main/agent-names.js › MAX_NAME` — the store that will actually hold it. A name legal here
   * that the desktop then refuses is a 200 followed by a refusal the orchestrator cannot explain.
   * ⚠ **`.min(1)` AFTER THE TRIM**, so `"   "` is refused rather than stored as a name nobody
   * typed: the empty string is meaningful on the RENAME arm (it clears) and meaningless here.
   * ⚠ **THE INVISIBLES ARE REFUSED, NOT STRIPPED**, character for character with that arm —
   * `agent-names.js › sanitizeName` is the authority at the far end and refuses rather than
   * strips, so accepting them here would file a directive the machine will only bounce.
   * ⚠ **AN ID-SHAPED NAME IS REFUSED BY THE TOOL, NOT HERE.** `packages/mcp-server ›
   * channel-ops-launch.ts` is where a caller can be told what to pass instead; a zod message is
   * not a place to teach.
   */
  agentName: z
    .string()
    .trim()
    .min(1, "An agent you launch needs a name")
    .max(60)
    .refine(
      (v) => !/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/.test(v),
      "Control, zero-width and bidi characters are refused, not stripped",
    ),
});
export type LaunchCreateInput = z.infer<typeof LaunchCreateSchema>;

/** The desktop claiming one directive. ⚠ One id, nothing else — everything that
 *  decides whether the claim succeeds is server-side. */
export const LaunchClaimSchema = z.object({
  directiveId: z.string().uuid(),
});
export type LaunchClaimInput = z.infer<typeof LaunchClaimSchema>;

/**
 * THE SIX-WORD REFUSAL CONTRACT, as a closed enum.
 *
 * ⚠ `closedEnum` so TS-side drift breaks the BUILD (the `schema.ts ›
 * VisibilitySchema` discipline): this list, `types.ts › LaunchRefusalReason` and
 * the column's `CHECK` are three statements of one set, and only this one is
 * checked by the compiler.
 * ⚠ CLOSED RATHER THAN FREE TEXT because the readable sentence is written by the
 * READER (`channel-ops-launch.ts`). Free text here would put agent-facing prose
 * on the machine that is hardest to update, and would render desktop-authored
 * text into an MCP result nobody neutralized.
 */
// ⚠ SEVEN SINCE 2026-08-22 (agent identities). `no-identity` is what a machine answers when a
// directive named an identity its OPERATOR cannot resolve — deleted, or invisible to them
// though visible to the orchestrator that named it.
// ⚠ THE COLUMN CHECK CAUGHT UP ON 2026-08-23. This enum ran one word ahead of
// `channel_launch_directives_refusal_reason_check` for a day, and this comment carried the
// standing instruction not to ship a producer into that window — a `decide` with the word would
// have passed here and been refused AT REST.
// `20260823140000_channel_launch_directives_template.sql` widens the CHECK and lands in the same
// wave as the producer (`main/launch-directives.js › spawn`, resolve-at-claim). The two lists
// agree again. ⚠ An EIGHTH word is still a schema change in both trees.
// ⚠ NINE SINCE 2026-09-01 (external end / rename). `no-session` and `bad-name`
// are the two words the in-process `dopl_agents` server already answers for these
// exact verbs, lifted onto the wire so the same fact reads the same way from
// outside. ⚠ THE COLUMN CHECK LANDS IN THE SAME WAVE this time
// (`20260907120000_channel_launch_directives_kind.sql`) — the 2026-08-22 window,
// where this list ran one word ahead of the CHECK and four files carried a
// standing "do not ship a producer yet", is exactly what that sequencing avoids.
// ⚠ TEN SINCE 2026-09-02. `no-chain` splits a fact off `no-bridge`: a directive that asked
// to CHAIN in a channel where the operator has not enabled it answered the SAME word this
// machine sends when it is not watching that channel at all. The two are opposite
// instructions — `no-bridge` says go elsewhere, `no-chain` says the channel is right and one
// named setting is off — so an orchestrator that read the first retried somewhere else
// instead of asking for one toggle. ⚠ THE COLUMN CHECK LANDS IN THE SAME WAVE
// (`20260910120000_channel_launch_directives_posture.sql` §3A).
export const LaunchRefusalReasonSchema =
  closedEnum<LaunchRefusalReason>()(LAUNCH_REFUSAL_REASONS);

/**
 * THE AGENT INSTANCE ID, AS A PARAM.
 *
 * ⚠ **BARE, ANCHORED, AND IDENTICAL TO {@link LaunchDecideSchema}'s `agentId`**
 * — `main/agent-id.js › AGENT_ID_RE` and the column CHECK, character for
 * character. The `@agent-<id>` form a caller pastes is stripped BEFORE it gets
 * here (`packages/mcp-server/src/tools/channel-ops-direct.ts › bareAgentId`, the
 * one this lane reuses), because that is what `read_sessions` prints and
 * refusing it would 400 a caller for doing exactly what the neighbouring op
 * taught.
 */
const AgentInstanceIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]{7}$/, "Invalid agent id");

/**
 * FILE AN `end`, `rename` OR `set_agent_mode` DIRECTIVE — the AGENT-MANAGEMENT
 * half of the lane (2026-09-01, Samuel: "dopl mcp being able to end agents";
 * the third arm is the agent-efficiency wave's re-posture verb).
 *
 * ⚠ **A DISCRIMINATED UNION ON `kind`, NOT ONE OBJECT WITH AN OPTIONAL `name`.**
 * A rename REQUIRES a name and an end must not carry one — the column CHECK says
 * the same at rest — and an object shape would let a rename with no name reach a
 * machine whose only honest answer is a refusal for a request that was never
 * expressible.
 *
 * ⚠ **NO `operatorUserId`, HERE OR ANYWHERE IN THIS FILE.** The whole point is
 * that the only machine an agent may reach is its own operator's, and the way
 * that stays true is that no schema on this path has a field for naming another.
 *
 * ⚠ `channel` IS REQUIRED even though an agent id alone would address the
 * target, and that is the FENCE rather than ergonomics: the create path proves a
 * MEMBERSHIP ROW in that channel (`service-launch.ts › createLaunchDirective`'s
 * gate 1), which is what stops this op being a bare "end agent `abcdefgh`"
 * primitive over the whole deployment. ⚠ It also means a caller must have got
 * the id from somewhere it could see — `read_sessions` — rather than by guessing.
 */
export const AgentDirectiveCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("end"),
    channel: z.string().min(1).max(200),
    agentId: AgentInstanceIdSchema,
  }),
  z.object({
    kind: z.literal("rename"),
    channel: z.string().min(1).max(200),
    agentId: AgentInstanceIdSchema,
    /**
     * ⚠ **60, AND THE EMPTY STRING IS LEGAL.** 60 is `main/agent-names.js ›
     * MAX_NAME` — the store that will actually hold it — not
     * `agent_identities.name`'s 120: a name legal here that the desktop then
     * refuses is a 200 followed by a refusal the orchestrator cannot explain.
     * Empty CLEARS, back to `Agent #<id>`; a separate `unname` verb would be a
     * second way to say one thing.
     * ⚠ NOT `safeLabel`, which has a `min(1)` — this is the one display string
     * in the feature whose empty value is meaningful. The charset rule it would
     * have applied is applied here instead, and the desktop's own `sanitizeName`
     * is the authority either way.
     */
    name: z
      .string()
      .trim()
      .max(60)
      .refine(
        (v) => !/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/.test(v),
        "Control, zero-width and bidi characters are refused, not stripped",
      ),
  }),
  /**
   * **RE-POSTURE A RUNNING AGENT** (2026-09-01, the agent-efficiency wave).
   *
   * ⚠ **BOTH AXES ARE OPTIONAL AND BOTH ABSENT IS REFUSED HERE, AT THE SCHEMA.**
   * A directive that asks for nothing is a request whose only honest answer is a
   * refusal for something that was never expressible — this file's own docblock
   * argues that against the rename arm, the column CHECK says it at rest, and
   * `main/directive-agent-ops.js › setAgentMode` answers `no-bridge` for the case
   * a machine can still reach (a mode IT does not recognise, narrowed away). ⚠ All
   * three are wanted: this one is the only place that costs the caller nothing —
   * a 400 now instead of a filed row, a claim and a two-minute round trip.
   * ⚠ THE REFINE HANGS ON THE ARM, NOT THE UNION, so `end` and `rename` are not
   * dragged through a predicate that says nothing about them and the message the
   * caller gets names this verb's own rule.
   *
   * ⚠ **NO `model` FIELD, AND THERE MUST NEVER BE ONE.** The desktop's narrower
   * has no `target_model` column to read (`main/launch-directive-wire.js ›
   * directiveFrom`), so a model here would be accepted, stored, and silently
   * dropped on the way in — the caller told its request landed while nothing
   * carried it. A running session's model is not re-postureable from this lane.
   */
  z
    .object({
      kind: z.literal("set_agent_mode"),
      channel: z.string().min(1).max(200),
      agentId: AgentInstanceIdSchema,
      /** ⚠ A REQUEST. The machine CLAMPS it to the operator's own stored channel
       *  posture and never widens (`main/launch-posture.js › narrowTo`), so no
       *  sentence built from this value may say "set". */
      tools: ToolModeSchema.optional(),
      messages: MessageModeSchema.optional(),
    })
    .refine(
      (v) => v.tools !== undefined || v.messages !== undefined,
      {
        error:
          'op="set_agent_mode" must ask for at least one axis: pass tools, messages, or both. A directive that names neither could only ever be refused.',
        path: ["tools"],
      },
    ),
]);
export type AgentDirectiveCreateInput = z.infer<
  typeof AgentDirectiveCreateSchema
>;

// ⚠ **THE DESKTOP'S TERMINAL DECISION MOVED TO `schema-launch-decide.ts` (§1 SPLIT, 2026-09-15)**
// — this file went over the 500-line cap when the launch gained a required `agentName` and the
// decide gained the `appliedAgentName` echo. The seam is a real one rather than arithmetic: this
// file is what a CALLER MAY ASK FOR and changes when the launch lane's arguments do; that file is
// what the MACHINE REPORTS BACK and changes when the echo does. ⚠ RE-EXPORTED so no importer moved
// (`schema.ts` re-exports both from here).
export { LaunchDecideSchema } from "./schema-launch-decide";
export type { LaunchDecideInput } from "./schema-launch-decide";
