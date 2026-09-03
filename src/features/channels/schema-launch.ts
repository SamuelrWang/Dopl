import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import type {
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
export const LAUNCH_TOOL_MODES = [
  "manual",
  "accept_edits",
  "auto",
  "bypass",
] as const;
/**
 * ⚠ **THIS ONE IS NOT A LADDER, AND ITS ORDER IS NOT A CLAMP RULE** (2026-09-02).
 * `LAUNCH_TOOL_MODES` above really is narrowest-first — manual ⊂ accept_edits ⊂
 * auto ⊂ bypass — and an index comparison is the right clamp for it. Here
 * `auto_inbound` and `auto_outbound` are two INDEPENDENT capabilities and
 * neither is wider than the other; the array order is only a stable spelling for
 * the zod enum and the column CHECK. Clamping this axis by index WIDENED on two
 * of sixteen pairs. `lib/agent-posture.ts › narrowMessageMode` intersects
 * capability bits instead, and `main/launch-posture.js` does the same.
 */
export const LAUNCH_MESSAGE_MODES = [
  "ask",
  "auto_inbound",
  "auto_outbound",
  "auto_both",
] as const;

const ToolModeSchema = closedEnum<LaunchToolMode>()(LAUNCH_TOOL_MODES);
const MessageModeSchema = closedEnum<LaunchMessageMode>()(LAUNCH_MESSAGE_MODES);

/**
 * **THE CHANNEL'S POSTURE CEILING** (2026-09-02, A9 — G6/G7), edited through the
 * ordinary channel PATCH and manage-gated there like the rest of the header.
 *
 * ⚠ **`null` IS A VALUE AND MEANS "CLEAR THE CEILING", which is why every axis
 * is `.nullable()` as well as `.optional()`.** Absent means "no opinion, leave
 * it"; `null` means "this channel records no ceiling any more". Collapsing the
 * two would make a recorded ceiling impossible to remove — the same
 * absent-vs-null distinction `mapChannelRow` reads back out.
 *
 * ⚠ IT REUSES THE TWO ORDERED ENUMS ABOVE rather than restating them. The
 * ceiling and the request must agree about what "wider" means, and `narrowTo`'s
 * comparison is an INDEX into those arrays.
 */
export const ChannelAgentPostureSchema = z.object({
  tools: ToolModeSchema.nullable().optional(),
  messages: MessageModeSchema.nullable().optional(),
  chain: z.boolean().nullable().optional(),
});
export type ChannelAgentPostureInput = z.infer<typeof ChannelAgentPostureSchema>;

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
   * THE AGENT TEMPLATE TO RUN AS — **an id OR an exact name** (2026-08-23).
   *
   * ⚠ ONE PARAM FOR BOTH, which is this tree's own idiom rather than a new
   * convention: `dopl_kb`'s `base` already takes either
   * (`knowledge-shared.ts › resolveBase`). The service disambiguates on shape —
   * UUID ⇒ id, otherwise a case-insensitive EXACT name over the caller-visible
   * set — and **refuses, listing every match, when a name is ambiguous.**
   * `agent_templates` has no name uniqueness on purpose (a unique index across a
   * visibility boundary leaks the existence of a private row through a conflict
   * error), so ambiguity is a legitimate state and every "pick one" rule is
   * silently surprising.
   *
   * ⚠ `safeLabel`, matching `model` beside it and for the same reason: the ref is
   * echoed back in the not-found refusal an MCP result renders, so it is
   * shape-bounded before it can carry a newline into a line we wrote. 120 is
   * `agent_templates.name`'s own bound — a name that is legal on a template must
   * never be refusable here, or a legitimate launch 400s.
   *
   * ⚠ NOT `.uuid()`, and never narrowed to one: refusing the NAME form here
   * would make an orchestrator carry ids it has no way to look up over this tool.
   */
  template: safeLabel("Template", 120).optional(),
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
// ⚠ SEVEN SINCE 2026-08-22 (agent templates). `no-template` is what a machine answers when a
// directive named a template its OPERATOR cannot resolve — deleted, or invisible to them
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
export const LaunchRefusalReasonSchema = closedEnum<LaunchRefusalReason>()([
  "cap",
  "busy",
  "no-sdk",
  "auth-hold",
  "no-bridge",
  "no-counterparty",
  "no-template",
  "no-session",
  "bad-name",
  "no-chain",
]);

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
     * `agent_templates.name`'s 120: a name legal here that the desktop then
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

/**
 * The desktop's terminal decision. ⚠ A DISCRIMINATED UNION, not an object with
 * two optional fields: `launched` REQUIRES an agent id and `refused` REQUIRES a
 * reason, and the column CHECK says the same thing at rest. An object shape
 * would let a machine post `refused` with no reason, leaving the MCP result
 * nothing honest to say about the one outcome that most needs wording.
 */
export const LaunchDecideSchema = z.discriminatedUnion("status", [
  z.object({
    directiveId: z.string().uuid(),
    status: z.literal("launched"),
    /** ⚠ Mirrors `dopl-desktop-app/main/agent-id.js` and the column CHECK
     *  character for character — it renders as `@<id>` in an MCP result, so a
     *  bad value must be a 400 that NAMES the field rather than a constraint
     *  violation surfacing as an opaque 500. */
    agentId: z.string().regex(/^[a-z][a-z0-9]{7}$/, "Invalid agent id"),
    /**
     * **THE ECHO TRIO — WHAT THE MACHINE SAYS IT ACTUALLY APPLIED** (2026-09-01,
     * T24's second half). The columns landed with the posture request and
     * nothing wrote them; these three fields are the writer.
     *
     * ⚠ **OPTIONAL, AND THE OPTIONALITY IS THE OLDER-DESKTOP CONTRACT**
     * (INVARIANTS §13 — an older peer is supported). A desktop that predates
     * this wave reports nothing, its decide body carries none of these keys, and
     * the columns stay `null` — which `channel-ops-launch.ts › postureFacts`
     * renders as `not reported`. Making any of them REQUIRED would 400 every
     * decide such a machine posts, i.e. it would turn "I cannot tell you what I
     * applied" into "I could not report at all", and the row would then expire
     * with a running agent behind it.
     * ⚠ **`null` MUST KEEP MEANING "NOT REPORTED".** Absent stays absent all the
     * way to the column (`service-launch.ts › decideLaunchDirective` maps an
     * undefined field to `null`) — it is NEVER filled in from the REQUEST
     * columns, which would be right whenever nothing was clamped and confidently
     * wrong exactly when it mattered.
     * ⚠ THE SAME FROZEN ENUMS THE REQUEST PAIR USES, and deliberately the same
     * declarations: a second literal here is the drift {@link LAUNCH_TOOL_MODES}
     * exists to prevent, and the column CHECK holds the echo columns to the same
     * members at rest.
     * ⚠ NOT ON THE `done` ARM. Only a LAUNCH resolves a start posture; an `end`
     * or a `rename` applies none, and a machine that reported one would be
     * asserting a fact about a session it did not start.
     */
    appliedTools: ToolModeSchema.optional(),
    appliedMessages: MessageModeSchema.optional(),
    /** ⚠ A REAL `false` — "this session may NOT launch workers" — and it is a
     *  DIFFERENT fact from an absent field. Absent is "not reported"; `false` is
     *  the machine saying it settled the chain OFF, which is what an orchestrator
     *  needs in order to stop planning for workers. */
    appliedChain: z.boolean().optional(),
  }),
  // ⚠ THE NON-LAUNCH KINDS' SUCCESS, 2026-09-01. It carries NO agent id: an end
  // and a rename both NAME their target in the row already (`target_agent_id`),
  // so a second id on the decide would be a field the machine could get wrong
  // about a row it did not write. The column CHECK pairs `done` with the
  // non-launch kinds and `launched` with `launch`, so the two successes can never
  // be confused for one another at rest.
  z.object({
    directiveId: z.string().uuid(),
    status: z.literal("done"),
  }),
  z.object({
    directiveId: z.string().uuid(),
    status: z.literal("refused"),
    refusalReason: LaunchRefusalReasonSchema,
  }),
]);
export type LaunchDecideInput = z.infer<typeof LaunchDecideSchema>;
