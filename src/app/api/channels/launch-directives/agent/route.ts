import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { AgentDirectiveCreateSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  createAgentDirective,
} from "@/features/channels/server/service";

/** File an agent-management directive (`end`, `rename`, `set_agent_mode`) for the operator's own
 *  desktop. Same lane as launches; only the create is separate, because the bodies share nothing.
 *  Not `sessionOnly`: the caller is an agent token over MCP. `end`/`rename` are not behind the
 *  desktop's launch toggle (they spend no compute); `set_agent_mode` is
 *  (`main/launch-directive-vocab.js › KINDS_NEEDING_LAUNCH_CONSENT`). The server never sees the toggle.
 *  A directive is not a message and never touches `channel_messages`. */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, AgentDirectiveCreateSchema);
    const ctx = buildChannelContext(auth);
    const result = await createAgentDirective(
      ctx,
      // Re-spread per arm so the discriminated union survives into the service signature.
      input.kind === "rename"
        ? {
            kind: "rename",
            channel: input.channel,
            agentId: input.agentId,
            name: input.name,
          }
        : input.kind === "set_agent_mode"
          ? {
              // A request, never a grant: the machine clamps each axis to the channel's posture.
              kind: "set_agent_mode",
              channel: input.channel,
              agentId: input.agentId,
              tools: input.tools,
              messages: input.messages,
            }
          : { kind: "end", channel: input.channel, agentId: input.agentId }
    );
    // `offline: true` is a 200: nothing failed and no row was created.
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
