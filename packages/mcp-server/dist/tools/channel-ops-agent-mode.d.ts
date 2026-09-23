/**
 * `dopl_channel` op="manage" action="posture": a management directive (held on the row via `holdRow`) asking that a running agent be re-postured.
 * It asks, never widens: the operator's machine clamps to its hand-set ceiling (`directive-agent-ops.js › setAgentMode`).
 * A null applied mode means "not reported" (older desktop), never "unclamped" (`channel-facts.ts › postureFacts`).
 * Unlike end/rename this kind IS gated by the launch-consent toggle, so `no-bridge` may mean the toggle is off.
 * The `channel-` filename prefix is load-bearing for the parity scans (`tool-group-files.ts`).
 */
import type { DoplClient, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * Per agent, never per thread — no oldest-agent fallback.
 * "At least one axis" is checked in `channel-dispatch-agents.ts`, then by the route and the column CHECK.
 */
export declare function opSetAgentMode(client: DoplClient, ref: string, agentId: string, modes: {
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
}, opts?: {
    waitMs?: number;
}): Promise<ToolResponse>;
