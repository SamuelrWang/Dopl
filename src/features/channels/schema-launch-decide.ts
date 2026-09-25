import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import { safeLabel } from "@/shared/lib/safe-label";
import {
  LAUNCH_APPLIED_TOOL_MODES,
  LAUNCH_MESSAGE_MODES,
  LAUNCH_REFUSAL_REASONS,
  LAUNCH_RUNTIME_ID_MESSAGE,
  LAUNCH_RUNTIME_ID_RE,
  LAUNCH_SETTING_RE,
} from "./schema-launch-modes";
import type {
  LaunchAppliedToolMode,
  LaunchMessageMode,
  LaunchRefusalReason,
} from "./types-launch";

// What the operator's machine reports back about one directive; the request side is
// `schema-launch.ts`. The enums come from the `schema-launch-modes.ts` leaf.
// A machine never echoes a level (the `applied_tool_mode` CHECK holds only runtime words).
const ToolModeSchema = closedEnum<LaunchAppliedToolMode>()(LAUNCH_APPLIED_TOOL_MODES);
const MessageModeSchema = closedEnum<LaunchMessageMode>()(LAUNCH_MESSAGE_MODES);
const LaunchRefusalReasonSchema =
  closedEnum<LaunchRefusalReason>()(LAUNCH_REFUSAL_REASONS);

/** `launched` requires an agent id and `refused` a reason. Every `applied*` is optional: absent
 *  means "not reported" (an older desktop, INVARIANTS §13) and is never back-filled from the
 *  request columns. */
export const LaunchDecideSchema = z.discriminatedUnion("status", [
  z.object({
    directiveId: z.string().uuid(),
    status: z.literal("launched"),
    /** Mirrors `dopl-desktop-app/main/agent-id.js` and the column CHECK. */
    agentId: z.string().regex(/^[a-z][a-z0-9]{7}$/, "Invalid agent id"),
    appliedTools: ToolModeSchema.optional(),
    appliedMessages: MessageModeSchema.optional(),
    /** `false` = the machine settled chaining off, a different fact from absent. */
    appliedChain: z.boolean().optional(),
    /** The machine's stored name, not an echo of the request (uniqueness may make it `Coder-1`). */
    appliedAgentName: safeLabel("Agent name", 60).optional(),
    /** What the session actually started on; `appliedModel` absent = that runtime's own default. */
    appliedRuntime: z
      .string()
      .trim()
      .regex(LAUNCH_RUNTIME_ID_RE, LAUNCH_RUNTIME_ID_MESSAGE)
      .optional(),
    appliedModel: safeLabel("Model", 120).optional(),
    /** The runtime's own effective setting, e.g. `never/danger-full-access`; the column CHECK's shape. */
    appliedSetting: z.string().regex(LAUNCH_SETTING_RE, "Invalid setting").optional(),
  }),
  // The non-launch kinds' success: no agent id (the row already names its target). It carries
  // `set_agent_mode`'s appliedTools/appliedMessages; only `launched` carries
  // chain/name/runtime/model.
  z.object({
    directiveId: z.string().uuid(),
    status: z.literal("done"),
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
