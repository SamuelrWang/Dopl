/**
 * `dopl_channel` op="manage" action="end" / "rename" for the operator's own running agents.
 * Management ops are directives: they ask, the operator's machine answers, and the row is held via `holdRow`.
 * The launch-consent toggle does not gate end/rename, so no copy here may tell a caller to turn it on.
 * The `channel-` filename prefix is load-bearing for the parity scans (`tool-group-files.ts`).
 */
import type { DoplClient, LaunchDirective, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type FactValue } from "./channel-facts";
/**
 * The three management kinds and their payloads — one declaration shared with `channel-ops-agent-mode.ts`.
 * "At least one axis" for set_agent_mode is checked in `channel-dispatch-agents.ts`, not typed here.
 */
export type AgentDirectiveKind = "end" | "rename" | "set_agent_mode";
export type AgentDirectiveInput = {
    kind: "end";
    channel: string;
    agentId: string;
} | {
    kind: "rename";
    channel: string;
    agentId: string;
    name: string;
} | {
    kind: "set_agent_mode";
    channel: string;
    agentId: string;
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
};
/** Keyed on the kind, never a display word. `retry=no`: a second directive is a second request for the same change. */
export declare function pendingFacts(d: LaunchDirective, kind: AgentDirectiveKind): Record<string, FactValue>;
/**
 * File the directive and hold it (`holdRow`) — plumbing shared with `channel-ops-agent-mode.ts`, which writes its own sentences.
 * A 404 on create is the channel, never the agent.
 */
export declare function fileAndHold(client: DoplClient, ref: string, input: AgentDirectiveInput, waitMs: number | undefined): Promise<{
    done: true;
    response: ToolResponse;
} | {
    done: false;
    directive: LaunchDirective;
} | {
    done: true;
    offline: true;
    response: ToolResponse;
}>;
/** End one of the operator's own running agents. A stop verb: no thread or message is touched. */
export declare function opEndAgent(client: DoplClient, ref: string, agentId: string, opts?: {
    waitMs?: number;
}): Promise<ToolResponse>;
/** Rename one of the operator's own agents: display-only, on one machine; nothing resolves an agent by name. An empty name clears. */
export declare function opRenameAgent(client: DoplClient, ref: string, agentId: string, name: string, opts?: {
    waitMs?: number;
}): Promise<ToolResponse>;
