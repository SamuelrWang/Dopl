/**
 * Requests to an operator's own desktop that the server only files: the launch mailbox (launch / end /
 * rename / set_agent_mode) and the private direct lane. Re-exported from `channel.ts`.
 */

import type { DoplTransport } from "./transport.js";
import type {
  AgentDirectiveCreateInput,
  AgentDirectiveCreated,
  LaunchDirective,
  LaunchDirectiveCreateInput,
  LaunchDirectiveCreated,
} from "./launch-types.js";
import type {
  AgentDirection,
  AgentDirectionCreateInput,
  AgentDirectionCreated,
} from "./direction-types.js";

const enc = encodeURIComponent;

/** File a launch request; `offline` means nothing was filed. No operator argument, by design. */
export async function createLaunchDirective(
  t: DoplTransport,
  input: LaunchDirectiveCreateInput
): Promise<LaunchDirectiveCreated> {
  return t.request<LaunchDirectiveCreated>("/api/channels/launch-directives", {
    method: "POST",
    body: input,
    toolName: "channel_launch_agent",
  });
}

/** File an end / rename / set_agent_mode on the same mailbox (`getLaunchDirective` polls it).
 *  The launch toggle does not gate end/rename, so never advise turning it on for their refusal. */
export async function createAgentDirective(
  t: DoplTransport,
  input: AgentDirectiveCreateInput
): Promise<AgentDirectiveCreated> {
  return t.request<AgentDirectiveCreated>(
    "/api/channels/launch-directives/agent",
    {
      method: "POST",
      body: input,
      toolName: "channel_agent_directive",
    }
  );
}

/** Poll one directive. Coarse polling only (1-2s); another operator's directive answers 404. */
export async function getLaunchDirective(
  t: DoplTransport,
  id: string
): Promise<LaunchDirective> {
  const data = await t.request<{ directive: LaunchDirective }>(
    `/api/channels/launch-directives/${enc(id)}`,
    { toolName: "channel_launch_poll" }
  );
  return data.directive;
}

// The private direct lane. `claim`/`decide` are deliberately unbound: only the desktop calls them,
// by path, and the MCP surface must never reach those verbs.

export async function createAgentDirection(
  t: DoplTransport,
  input: AgentDirectionCreateInput
): Promise<AgentDirectionCreated> {
  return t.request<AgentDirectionCreated>("/api/channels/agent-directions", {
    method: "POST",
    body: input,
    toolName: "channel_direct_agent",
  });
}

export async function getAgentDirection(
  t: DoplTransport,
  id: string
): Promise<AgentDirection> {
  const data = await t.request<{ direction: AgentDirection }>(
    `/api/channels/agent-directions/${enc(id)}`,
    { toolName: "channel_direct_poll" }
  );
  return data.direction;
}

/** The caller's own recent directions, terminal rows included (the `reply` is the point). */
export async function listAgentDirections(
  t: DoplTransport,
  query: { channel?: string; agent?: string } = {}
): Promise<AgentDirection[]> {
  const params = new URLSearchParams();
  if (query.channel) params.set("channel", query.channel);
  if (query.agent) params.set("agent", query.agent);
  const qs = params.toString();
  const data = await t.request<{ directions: AgentDirection[] }>(
    `/api/channels/agent-directions/recent${qs ? `?${qs}` : ""}`,
    { toolName: "channel_read_directions" }
  );
  return data.directions;
}
