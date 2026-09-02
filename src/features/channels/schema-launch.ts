import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import type { LaunchRefusalReason } from "./types";

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
 * FILE AN `end` OR `rename` DIRECTIVE — the AGENT-MANAGEMENT half of the lane
 * (2026-09-01, Samuel: "dopl mcp being able to end agents").
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
