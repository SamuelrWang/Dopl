"use strict";
/**
 * Home-surface methods (class side: `client-home.ts`), both on `/api/channels?scope=account` —
 * user-scoped (`withUserAuth`, no `X-Workspace-Id`); the param is sent because an absent `scope`
 * means `container`. No link mint/revoke/claim is bound: those are `sessionOnly` (they reach a person).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHomeChannels = getHomeChannels;
exports.createHomeChannel = createHomeChannel;
/**
 * Every channel the caller is in, every container kind (tell them apart by `Channel.container`).
 * Not narrowed here: the container lock is per MCP connection
 * (`packages/mcp-server/src/workspace-directory.ts › narrowToLock`), and a reader that skips it
 * rebuilds the enumeration the lock denies.
 */
async function getHomeChannels(t) {
    return t.request("/api/channels?scope=account", {
        toolName: "home_list_channels",
    });
}
/** Create a home channel (a solo container plus one private channel). Reachable by an agent token:
 *  a room you are alone in reaches no other person. */
async function createHomeChannel(t, input) {
    return t.request("/api/channels?scope=account", {
        method: "POST",
        body: input,
        toolName: "home_create_channel",
    });
}
