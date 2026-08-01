"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelAgentsClient = void 0;
const agents = __importStar(require("./channel-agents.js"));
class ChannelAgentsClient {
    transport;
    /**
     * PROTECTED, not private: every link in the chain above reads it, and
     * `DoplClient` is the one that constructs it.
     */
    constructor(transport) {
        this.transport = transport;
    }
    // ─── Channel agents ────────────────────────────────────────────────
    // A channel is a ROOM: its human members plus the named agents they summon.
    // An agent is owned by ONE member and runs on THAT member's machine, which
    // is why summoning is member-gated and renaming / parking is owner-gated,
    // server-side.
    listChannelAgents(channelId) {
        return agents.listChannelAgents(this.transport, channelId);
    }
    createChannelAgent(channelId, input = {}) {
        return agents.createChannelAgent(this.transport, channelId, input);
    }
    updateChannelAgent(channelId, agentId, input) {
        return agents.updateChannelAgent(this.transport, channelId, agentId, input);
    }
    // ─── Thread participants (breakout rooms) ──────────────────────────
    // A thread with a participant set is a BREAKOUT ROOM: the set, not the
    // creator/target pair, is who may post into it. Both writes are idempotent.
    addThreadParticipant(channelId, threadId, identity) {
        return agents.addThreadParticipant(this.transport, channelId, threadId, identity);
    }
    removeThreadParticipant(channelId, threadId, identity) {
        return agents.removeThreadParticipant(this.transport, channelId, threadId, identity);
    }
}
exports.ChannelAgentsClient = ChannelAgentsClient;
