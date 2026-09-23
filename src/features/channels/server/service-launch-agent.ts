import "server-only";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";
import type {
  LaunchDirective,
  LaunchMessageMode,
  LaunchToolMode,
} from "../types";
import {
  AgentDirectiveForeignError,
  LaunchDirectiveNotFoundError,
} from "./errors";
import * as launchRepo from "./repository-launch";
import { agentIsAnotherMembers } from "./repository-agent-owner";
import { toDirective } from "./service-launch-dto";
import { operatorIsOnline } from "./service-launch";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/** Agent management over MCP (end, rename, re-posture) as kinds of launch directive: the launch
 *  mailbox is the one path to a desktop main process. Which kinds need the desktop's launch toggle is
 *  the machine's call (`main/launch-directives.js › handle`); the server never sees the toggle. */

/** Mirrors `schema-launch.ts › AgentDirectiveCreateSchema`; the column CHECK says the same at rest. */
export type CreateAgentDirectiveInput =
  | { kind: "end"; channel: string; agentId: string }
  /** `name: ""` clears the name (back to `Agent #<id>`). */
  | { kind: "rename"; channel: string; agentId: string; name: string }
  /** At least one axis (schema and column CHECK). A request, never a grant: the machine clamps each
   *  axis (`main/launch-posture.js › narrowTo`). No model: the narrower has no field for one. */
  | {
      kind: "set_agent_mode";
      channel: string;
      agentId: string;
      tools?: LaunchToolMode;
      messages?: LaunchMessageMode;
    };

/** `offline`: no row was created. Same envelope as `CreateLaunchResult`. */
export type CreateAgentDirectiveResult =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };

/** Refuses a target another member's machine freshly reported. Not the fence (`operator_user_id` is);
 *  it only turns a late `no-session` into an immediate sentence. Refuses only on a positive fact: an
 *  unknown id proceeds and the machine answers (`repository-agent-owner.ts`). */
async function refuseForeignTarget(
  ctx: ChannelContext,
  agentId: string
): Promise<void> {
  if (await agentIsAnotherMembers(ctx.workspaceId, agentId, ctx.userId)) {
    throw new AgentDirectiveForeignError(agentId);
  }
}

/** File an `end`, `rename` or `set_agent_mode` directive. `operator_user_id` is `ctx.userId`; no
 *  input field names an operator. Gates: membership → foreign target → presence (a caller error
 *  needs no machine).
 *  The channel is required even though the agent id addresses the target, so this is never a bare
 *  deployment-wide "end agent X". Liveness is not checked: only the machine knows (`no-session`). */
export async function createAgentDirective(
  ctx: ChannelContext,
  input: CreateAgentDirectiveInput
): Promise<CreateAgentDirectiveResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, input.channel);
  if (membership === null) {
    // Not-found shaped, as on the launch create: a non-member learns nothing new about the room.
    throw new LaunchDirectiveNotFoundError(input.channel);
  }

  await refuseForeignTarget(ctx, input.agentId);

  if (!(await operatorIsOnline(ctx))) {
    return { offline: true, directive: null };
  }

  const now = Date.now();
  const row = await launchRepo.insertLaunchDirective(ctx.userId, {
    kind: input.kind,
    workspace_id: ctx.workspaceId,
    channel_id: channel.id,
    // An agent is addressed as an instance, never scoped to a thread.
    task_id: null,
    goal: null,
    model: null,
    identity_id: null,
    identity_name: null,
    target_agent_id: input.agentId,
    // `null` on an end, a string (maybe '') on a rename; the column CHECK enforces both directions.
    target_name: input.kind === "rename" ? input.name : null,
    // Only on `set_agent_mode` (column CHECK); `null` per axis = leave that axis alone.
    target_tool_mode:
      input.kind === "set_agent_mode" ? input.tools ?? null : null,
    target_message_mode:
      input.kind === "set_agent_mode" ? input.messages ?? null : null,
    // The launch TTL: both wait on a claim, not a turn (unlike the direction lane).
    expires_at: new Date(now + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
  });
  return { offline: false, directive: toDirective(row, now) };
}
