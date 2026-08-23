"use strict";
/**
 * Channel method group — link 7 of the chain in `client-base.ts`. Pure
 * delegation to `channel.ts`; no HTTP here.
 *
 * Cross-user, agent-to-agent collaboration threads. Messages carry a monotonic
 * `seq` cursor; `awaitChannelMessages` long-polls past a cursor so a listener
 * watches a channel without busy-looping.
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
exports.ChannelMethods = void 0;
const client_members_js_1 = require("./client-members.js");
const channel = __importStar(require("./channel.js"));
class ChannelMethods extends client_members_js_1.MemberMethods {
    listChannels(opts) {
        return channel.listChannels(this.transport, opts);
    }
    getChannel(channelId) {
        return channel.getChannel(this.transport, channelId);
    }
    createChannel(input) {
        return channel.createChannel(this.transport, input);
    }
    listChannelMembers(channelId) {
        return channel.listChannelMembers(this.transport, channelId);
    }
    inviteToChannel(channelId, userId) {
        return channel.inviteToChannel(this.transport, channelId, userId);
    }
    readChannelMessages(channelId, opts) {
        return channel.readMessages(this.transport, channelId, opts);
    }
    postChannelMessage(channelId, input) {
        return channel.postMessage(this.transport, channelId, input);
    }
    awaitChannelMessages(channelId, opts) {
        return channel.awaitMessages(this.transport, channelId, opts);
    }
    /** One page of a channel's threads, most recently active first, plus whether
     *  the server's ceiling clipped it. ⚠ Never re-sort the page — see
     *  `channel.ts › listChannelThreads`. */
    /** WORKSPACE-WIDE long-poll — every channel the caller is a MEMBER of, one
     *  cursor (`seq` is workspace-global). ⚠ Narrower than a channel READ: a public
     *  channel the caller never joined is not watched. */
    awaitWorkspaceMessages(opts) {
        return channel.awaitWorkspaceMessages(this.transport, opts);
    }
    listChannelThreads(channelId) {
        return channel.listChannelThreads(this.transport, channelId);
    }
    /** The caller's OWN sessions, telemetry included — own-scoped at the server. */
    /** Ask the operator's OWN desktop to start an agent. ⚠ A REQUEST — the machine
     *  may refuse with one of six words, and `offline: true` means nothing was
     *  even filed. There is no operator argument, deliberately. */
    createLaunchDirective(input) {
        return channel.createLaunchDirective(this.transport, input);
    }
    /** Poll one launch directive. ⚠ Coarse (1-2s) — see `channel.ts`. */
    getLaunchDirective(id) {
        return channel.getLaunchDirective(this.transport, id);
    }
    /** ⚠ A PAGE since 2026-08-23 (F-294), not a bare array: `operatorOnline`
     *  rides beside the rows because presence is a fact about the MACHINE, not
     *  about any one session. See `channel-types.ts › ChannelSessionsPage`. */
    listChannelSessions(channelId) {
        return channel.listChannelSessions(this.transport, channelId);
    }
    getChannelThread(channelId, threadId) {
        return channel.getChannelThread(this.transport, channelId, threadId);
    }
    createChannelThread(channelId, input) {
        return channel.createChannelThread(this.transport, channelId, input);
    }
    // ⚠ `closeChannelThread` (human lane) and `proposeChannelThreadClose` (agent
    // lane) were methods here until thread closing was removed (wiring plan
    // Phase 4, 2026-08-18). `client-surface.test.ts` records the arithmetic.
    setChannelThreadMode(channelId, threadId, input) {
        return channel.setChannelThreadMode(this.transport, channelId, threadId, input);
    }
}
exports.ChannelMethods = ChannelMethods;
