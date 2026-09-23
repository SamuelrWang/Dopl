import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import { safeLabel } from "@/shared/lib/safe-label";
import {
  LAUNCH_MESSAGE_MODES,
  LAUNCH_TOOL_MODES,
  LAUNCH_REFUSAL_REASONS,
  LAUNCH_RUNTIME_ID_MESSAGE,
  LAUNCH_RUNTIME_ID_RE,
} from "./schema-launch-modes";
import type {
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "./types";

// ⚠ **THE THREE FROZEN VOCABULARIES ARE BUILT FROM THE SHARED ARRAYS, NEVER IMPORTED FROM
// `schema-launch.ts`.** That file re-exports this one (so no importer moved), and importing its
// consts back would be a MODULE-EVAL cycle rather than a type one — measured: `ToolModeSchema`
// arrived `undefined` and every schema suite failed to collect. `schema-launch-modes.ts` is the
// leaf both ends read, so the members are still declared exactly once.
const ToolModeSchema = closedEnum<LaunchToolMode>()(LAUNCH_TOOL_MODES);
const MessageModeSchema = closedEnum<LaunchMessageMode>()(LAUNCH_MESSAGE_MODES);
const LaunchRefusalReasonSchema =
  closedEnum<LaunchRefusalReason>()(LAUNCH_REFUSAL_REASONS);

/**
 * **WHAT THE OPERATOR'S MACHINE REPORTS BACK ABOUT ONE DIRECTIVE** (§1 split out of
 * `schema-launch.ts` on 2026-09-15, at the 500-line cap).
 *
 * ⚠ **THE SEAM IS REQUEST vs REPORT.** `schema-launch.ts` is what a CALLER may ASK for — the
 * launch arguments, the agent-management verbs, the claim — and it changes when this lane's
 * arguments do. This is the other direction, and it changes when the ECHO does: it gained
 * `appliedTools`/`appliedMessages`/`appliedChain` on 2026-09-01 (T24) and `appliedAgentName` on
 * 2026-09-15 (Samuel's name-uniqueness ruling), neither of which is a thing anybody asks for.
 */

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
     * ⚠ The `done` arm carries the same pair for `set_agent_mode` (F2); only this arm
     * carries `appliedChain`.
     */
    appliedTools: ToolModeSchema.optional(),
    appliedMessages: MessageModeSchema.optional(),
    /** ⚠ A REAL `false` — "this session may NOT launch workers" — and it is a
     *  DIFFERENT fact from an absent field. Absent is "not reported"; `false` is
     *  the machine saying it settled the chain OFF, which is what an orchestrator
     *  needs in order to stop planning for workers. */
    appliedChain: z.boolean().optional(),
    /**
     * **WHAT THE AGENT IS ACTUALLY CALLED** (Samuel, 2026-09-15). ⚠ THE MACHINE'S OWN VALUE, not
     * an echo of {@link LaunchCreateSchema}'s `agentName`: the uniqueness rule may have stored
     * `Coder-1`, and an orchestrator that went on tagging `@coder` would reach the OTHER agent.
     * ⚠ THE SAME 60/charset bound the request takes — a name legal to ask for must be legal to
     * report. ⚠ Absent is "not reported" (an older desktop), never "unnamed".
     */
    appliedAgentName: safeLabel("Agent name", 60).optional(),
    /**
     * **WHICH RUNTIME THE SESSION ACTUALLY STARTED ON, AND WHICH MODEL IT ACTUALLY GOT**
     * (2026-09-21, U9).
     *
     * ⚠ **THE `applied_*` HALF OF THE REQUESTED/APPLIED PAIR, AND THEY ARE NOT SPELLINGS OF THE
     * REQUEST.** `LaunchCreateSchema.runtime` is what the orchestrator ASKED for; these are what
     * the machine SETTLED ON after the channel/registry chain resolved. They differ on every
     * launch that named no runtime — the ordinary case — which is precisely why an audit record
     * that carried only the request could not explain what ran.
     *
     * ⚠ **`appliedModel` IS NOT `resolved_model`.** That column is the SERVER's echo of the
     * model id it recognised at create time, and it is Claude-shaped. This is what the machine
     * handed its own launch funnel, inside the resolved runtime — `''`/absent meaning "no model
     * argument at all", i.e. that runtime's own default, which is the honest answer whenever a
     * cross-vendor model was dropped rather than smuggled.
     *
     * ⚠ **OPTIONAL, ON THE ECHO TRIO'S CONTRACT** (INVARIANTS §13): a desktop older than this
     * wave reports neither, the columns stay `null`, and `null` renders as `not reported` —
     * never as agreement with the request.
     * ⚠ NOT ON THE `done` ARM: only a LAUNCH starts a session on a runtime.
     */
    appliedRuntime: z
      .string()
      .trim()
      .regex(LAUNCH_RUNTIME_ID_RE, LAUNCH_RUNTIME_ID_MESSAGE)
      .optional(),
    appliedModel: safeLabel("Model", 120).optional(),
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
    // `set_agent_mode`'s echo (F2): zod strips unknown keys, so without these the machine's
    // report was dropped and stored as "not reported". Absent on `end` / `rename`. No chain: a
    // re-posture decides none. The columns are not kind-scoped (`20260910120000` §5).
    appliedTools: ToolModeSchema.optional(),
    appliedMessages: MessageModeSchema.optional(),
  }),
  z.object({
    directiveId: z.string().uuid(),
    status: z.literal("refused"),
    refusalReason: LaunchRefusalReasonSchema,
  }),
]);
export type LaunchDecideInput = z.infer<typeof LaunchDecideSchema>;
