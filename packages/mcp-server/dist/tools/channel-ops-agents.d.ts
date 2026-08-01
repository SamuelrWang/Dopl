/**
 * `dopl_channel` MULTIPLAYER op handlers: agents (list) / summon_agent /
 * rename_agent / set_agent_status / disengage_agent / join_thread /
 * leave_thread.
 *
 * A NEW file rather than more of `channel-ops-write.ts` (453 lines, §2): these
 * ops are about WHO IS IN THE ROOM, not about what gets said in it. Agent
 * identity itself — how a handle is resolved and how it is rendered — lives one
 * file over in `channel-agent-refs.ts`, because `post`, `create_thread` and
 * `get_thread` all need it and none of them belong here. The `channel-`
 * filename prefix is required by the parity split-scan (parity.test.ts).
 *
 * THE MODEL, once: a CHANNEL is a ROOM — its human members plus the named
 * agents they summon. A THREAD with a participant set is a BREAKOUT ROOM. An
 * agent is owned by ONE member and runs on THAT member's machine, so summoning
 * is member-gated and renaming / parking is owner-gated, server-side.
 *
 * NARRATION: every agent handle here is rendered by {@link agentLabel} and
 * every owner name by `memberRef` — both neutralized, both carrying the
 * immutable id. See the header of `channel-agent-refs.ts` for why a
 * charset-bounded handle is neutralized anyway.
 */
import type { AgentStatus, DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * The room's agent roster. A READ: the route gates it on the CHANNEL's own
 * visibility, because a peer has to see a handle before it can address it.
 *
 * Carries {@link UNTRUSTED_ROSTER_HEADER} rather than a fifth header of its
 * own: the untrusted half of these lines is the OWNER's
 * `profiles.display_name` — the same column, set by the same people, that the
 * member roster's header already frames.
 */
export declare function opAgents(client: DoplClient, channelRef: string, selfUserId?: string | null): Promise<ToolResponse>;
/**
 * Summon an agent into the channel. The caller becomes its OWNER, and the
 * handle comes from the server's curated pool unless one is asked for by name.
 */
export declare function opSummonAgent(client: DoplClient, channelRef: string, name?: string): Promise<ToolResponse>;
/** Rename an agent. OWNER ONLY — the server refuses anyone else. */
export declare function opRenameAgent(client: DoplClient, channelRef: string, agentRef: string, name: string): Promise<ToolResponse>;
/**
 * Move an agent along its lifecycle. OWNER ONLY — the states describe a
 * process on the owner's own machine.
 */
export declare function opSetAgentStatus(client: DoplClient, channelRef: string, agentRef: string, status: AgentStatus): Promise<ToolResponse>;
/**
 * END an agent's ENGAGEMENT — it goes back to IDLE: still in the room, still
 * reading everything, acting only on messages that TAG it.
 *
 * NOT OWNER-ONLY, and it is the only write in this file that is not. The server
 * allows the owner OR the human recorded as having engaged it
 * (`service-agents.ts#disengageAgent`), because engagement is a relationship
 * between an agent and the person who addressed it: ending an agent's attention
 * to YOUR messages is a different act from parking somebody else's process. The
 * refusal text below therefore may NOT reuse {@link agentWriteError}'s "an agent
 * belongs to the member who summoned it" line — that sentence is true of rename
 * and park and false here, and an engager told they must own the agent would
 * stop asking for the one thing they are entitled to do.
 *
 * IDEMPOTENT server-side: an already-idle agent clears to the same two nulls, so
 * this reads the same whether or not anything was engaged. That is stated rather
 * than hidden — an agent that reads "disengaged" as proof it HAD been engaged
 * would infer an exchange that never happened.
 *
 * THE RESULT MAY NOT OFFER THE CALLER A RE-ENGAGE, and it did until 2026-07-31
 * ("address it by handle again — that re-engages it"). `recordAgentEngagement`
 * (`service-writes-agents.ts`) now opens with `if (ctx.source === "agent")
 * return;` — engagement requires a HUMAN CREDENTIAL, because `authorKind` is
 * caller-assertable and `ctx.source` is derived from the token — and every post
 * made through this tool carries an agent token. So the one remedy the op
 * offered was an effect the reader cannot cause: it would tag the agent, watch
 * it answer that single message, and find it idle again on the next turn with
 * nothing saying why. What the reader CAN cause is a THREAD with a participant
 * set, which is the sustained-attention mechanism that does not go through
 * engagement at all — so that is what the result names instead.
 */
export declare function opDisengageAgent(client: DoplClient, channelRef: string, agentRef: string): Promise<ToolResponse>;
/** Which identity a join/leave names — exactly one of the two. */
interface ParticipantArgs {
    /** A human channel member: an email or user id. */
    member?: string;
    /** An agent of this channel: a handle or an agent id. */
    agent?: string;
}
/**
 * Admit an identity to a thread's participant set — which is what makes the
 * thread a BREAKOUT ROOM. Idempotent server-side: joining twice returns the row
 * already there, so a retry converges instead of erroring.
 */
export declare function opJoinThread(client: DoplClient, channelRef: string, threadId: string, who: ParticipantArgs): Promise<ToolResponse>;
/** Remove an identity from a thread's participant set. Idempotent. */
export declare function opLeaveThread(client: DoplClient, channelRef: string, threadId: string, who: ParticipantArgs): Promise<ToolResponse>;
export {};
