/**
 * Requests to an operator's own desktop that the server only files: the launch mailbox (launch / end /
 * rename / set_agent_mode) and the private direct lane. Re-exported from `channel.ts`.
 */
import type { DoplTransport } from "./transport.js";
import type { AgentDirectiveCreateInput, AgentDirectiveCreated, LaunchDirective, LaunchDirectiveCreateInput, LaunchDirectiveCreated } from "./launch-types.js";
import type { AgentDirection, AgentDirectionCreateInput, AgentDirectionCreated } from "./direction-types.js";
/** File a launch request; `offline` means nothing was filed. No operator argument, by design. */
export declare function createLaunchDirective(t: DoplTransport, input: LaunchDirectiveCreateInput): Promise<LaunchDirectiveCreated>;
/** File an end / rename / set_agent_mode on the same mailbox (`getLaunchDirective` polls it).
 *  The launch toggle does not gate end/rename, so never advise turning it on for their refusal. */
export declare function createAgentDirective(t: DoplTransport, input: AgentDirectiveCreateInput): Promise<AgentDirectiveCreated>;
/** Poll one directive. Coarse polling only (1-2s); another operator's directive answers 404. */
export declare function getLaunchDirective(t: DoplTransport, id: string): Promise<LaunchDirective>;
export declare function createAgentDirection(t: DoplTransport, input: AgentDirectionCreateInput): Promise<AgentDirectionCreated>;
export declare function getAgentDirection(t: DoplTransport, id: string): Promise<AgentDirection>;
/** The caller's own recent directions, terminal rows included (the `reply` is the point). */
export declare function listAgentDirections(t: DoplTransport, query?: {
    channel?: string;
    agent?: string;
}): Promise<AgentDirection[]>;
