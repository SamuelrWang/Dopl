import { z } from "zod";
import {
  SAFE_LABEL_RE,
  safeLabel,
  safeLabelMessage,
  safeOptionalLabel,
} from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import { AGENT_COLOR_KEYS } from "./lib/agent-colors";
import type {
  AgentColorKey,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "./types";

/** No schema here has an `operatorUserId` field and none may: `server/service-launch.ts` stamps
 *  it from the auth context, so a caller can never name another operator's machine. */

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

export const LaunchCreateSchema = z.object({
  channel: z.string().min(1).max(200),
  threadId: z.string().uuid().optional(),
  goal: z.string().trim().min(1).max(2000).optional(),
  /** Not an enum: the model set is the desktop's (an unknown pick is refused `no-model` there). */
  model: safeLabel("Model", 120).optional(),
  /** A SHAPE, not an enum: membership is the desktop registry's, and an unregistered explicit
   *  runtime is refused `no-sdk` there, never swapped. Never inferred from `model`. */
  runtime: z
    .string()
    .trim()
    .regex(LAUNCH_RUNTIME_ID_RE, LAUNCH_RUNTIME_ID_MESSAGE)
    .optional(),
  /** Id OR exact name; names are not unique, so the service refuses an ambiguous one. 120 is
   *  `agent_identities.name`'s bound. */
  identity: safeLabel("Identity", 120).optional(),
  /** A request in the launch runtime's own words: the machine clamps each axis to the operator's
   *  stored channel posture (`main/launch-posture.js › resolvePosture`) and never widens. */
  tools: ToolModeSchema.optional(),
  messages: MessageModeSchema.optional(),
  /** Tri-state: omitted inherits the channel setting, `false` always wins, and a `true` the
   *  channel forbids is refused `no-chain` (`main/launch-posture.js › resolveChain`). */
  chain: z.boolean().optional(),
  /** Idempotency key, unique per `(channel_id, operator_user_id)`. */
  clientMsgId: z.string().min(1).max(200).optional(),
  /** Omitted = the server picks the first free key. A named key that is taken is a 409 with the
   *  free set (`server/errors.ts › AgentColorTakenError`), never substituted. */
  color: closedEnum<AgentColorKey>()(AGENT_COLOR_KEYS).optional(),
  /** Required because the caller is an agent (a human launch defaults to `New Agent`). 60 and the
   *  refused invisibles match `main/agent-names.js › MAX_NAME` / `sanitizeName`. */
  agentName: z
    .string()
    .trim()
    .min(1, "An agent you launch needs a name")
    .max(60)
    .regex(SAFE_LABEL_RE, safeLabelMessage("Agent name")),
});
export type LaunchCreateInput = z.infer<typeof LaunchCreateSchema>;

export const LaunchClaimSchema = z.object({
  directiveId: z.string().uuid(),
});
export type LaunchClaimInput = z.infer<typeof LaunchClaimSchema>;

/** Closed: the readable sentence is written by the reader (`channel-ops-launch.ts`), never the
 *  desktop, and drift from `LaunchRefusalReason` breaks the build. */
export const LaunchRefusalReasonSchema =
  closedEnum<LaunchRefusalReason>()(LAUNCH_REFUSAL_REASONS);

/** Matches `main/agent-id.js › AGENT_ID_RE` and the column CHECK; a pasted `@agent-` prefix is
 *  stripped first (`packages/mcp-server/src/tools/channel-ops-direct.ts › bareAgentId`). */
const AgentInstanceIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]{7}$/, "Invalid agent id");

/** `channel` is required as the fence: the create proves a membership row there
 *  (`server/service-launch-agent.ts › createAgentDirective`), so this is no bare "end X". */
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
    /** 60 is `main/agent-names.js › MAX_NAME`; `""` clears the name back to `Agent #<id>`. */
    name: safeOptionalLabel("Name", 60),
  }),
  /** Both axes are requests the machine clamps. No `model` field: the desktop reads no
   *  `target_model`, so it would be silently dropped. */
  z
    .object({
      kind: z.literal("set_agent_mode"),
      channel: z.string().min(1).max(200),
      agentId: AgentInstanceIdSchema,
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

export { LaunchDecideSchema } from "./schema-launch-decide";
export type { LaunchDecideInput } from "./schema-launch-decide";
