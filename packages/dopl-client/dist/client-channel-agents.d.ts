/**
 * THE MULTIPLAYER METHOD GROUP of `DoplClient` — channel AGENTS and thread
 * PARTICIPANTS — held one layer below the client class itself.
 *
 * WHY IT IS A BASE CLASS AND NOT FIVE MORE METHODS ON `client.ts` (§2). That
 * file is a facade: ~60 one-line delegations across eight domains, 696 lines
 * before this wave and over the 500-line cap for long enough to have its own
 * row in the ENGINEERING §2 table, where the scheduled remedy is written down —
 * "continue per-domain method-group extraction". A facade cannot be split by
 * responsibility (it has one) or by layer (it has none); the only seam it has
 * is the DOMAIN, and the only way to move a domain's methods out while keeping
 * `client.listChannelAgents(...)` working for every existing caller — the MCP
 * tools, the app's `/api/mcp` route — is for the client to inherit them. So
 * this is the first link of that chain: no behaviour, no new surface, the same
 * public API, and one domain's worth of lines off the facade.
 *
 * ADDING THE NEXT LINK: give the group its own `client-<domain>.ts` with a
 * class that takes the transport the same way this one does, chain it
 * (`class ClientB extends ClientA`), and have `DoplClient` extend the last.
 * The transport stays a constructor parameter property so every link reads
 * `this.transport` and none of them owns its construction — `DoplClient` still
 * does, in `client.ts`, where a reader looks for it.
 *
 * The wire calls themselves stay in `channel-agents.ts` (free functions over
 * `DoplTransport`, exactly like `channel.ts`); this class is delegation only.
 */
import type { DoplTransport } from "./transport.js";
import type { ChannelAgent, ChannelAgentCreateInput, ChannelAgentUpdateInput, ThreadParticipant, ThreadParticipantRef } from "./channel-types.js";
export declare class ChannelAgentsClient {
    protected transport: DoplTransport;
    /**
     * PROTECTED, not private: every link in the chain above reads it, and
     * `DoplClient` is the one that constructs it.
     */
    constructor(transport: DoplTransport);
    listChannelAgents(channelId: string): Promise<ChannelAgent[]>;
    createChannelAgent(channelId: string, input?: ChannelAgentCreateInput): Promise<ChannelAgent>;
    updateChannelAgent(channelId: string, agentId: string, input: ChannelAgentUpdateInput): Promise<ChannelAgent>;
    addThreadParticipant(channelId: string, threadId: string, identity: ThreadParticipantRef): Promise<ThreadParticipant>;
    removeThreadParticipant(channelId: string, threadId: string, identity: ThreadParticipantRef): Promise<void>;
}
