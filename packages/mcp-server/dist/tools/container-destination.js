"use strict";
/**
 * Did this call land in a home channel? One probe shared by `dopl_agent` and `dopl_kb`.
 * A convenience, never the fence (the server's `home-channel-destination.ts` is), so every function fails open to "not known".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESTINATION_HEADINGS = exports.HOME_CHANNEL_ROW_NOT_SHARED_CODE = void 0;
exports.homeChannelRowNotShared = homeChannelRowNotShared;
exports.resolveHomeChannelContainer = resolveHomeChannelContainer;
exports.landsInHomeSpace = landsInHomeSpace;
exports.resolveHomeChannelId = resolveHomeChannelId;
exports.resolveChannelShareTarget = resolveChannelShareTarget;
const client_1 = require("@dopl/client");
const respond_js_1 = require("./respond.js");
/** The server's 400 for "a home channel holds only what is shared into it"; one spelling for both write surfaces. */
exports.HOME_CHANNEL_ROW_NOT_SHARED_CODE = "HOME_CHANNEL_ROW_NOT_SHARED";
/** The two destinations as list headings, one table for both surfaces; "Shared in this channel" (the app's wording), never "Public". */
exports.DESTINATION_HEADINGS = {
    shared: "Shared in this channel",
    personal: "Home (personal) — yours, visible in every home channel",
    /** F-735: rows in the retired destination — rendered (never dropped) and labelled so they are not treated as live. */
    legacy: "Legacy — not visible anywhere in the app",
};
/** The server's fence as a refusal in its own sentence; null → the caller rethrows. */
function homeChannelRowNotShared(e) {
    if (!(0, respond_js_1.isApiError)(e, 400, exports.HOME_CHANNEL_ROW_NOT_SHARED_CODE))
        return null;
    return (0, respond_js_1.err)(`${(0, respond_js_1.apiMessage)(e) ?? "A home channel holds only what is shared into it."} Pass container="home" to keep it in your home space instead.`);
}
/** The home-channel container this call landed in, or null ("not known"); the per-call ALS override beats the session default. */
async function resolveHomeChannelContainer(client, 
/** Optional: an absent directory means "not known" (null). */
directory) {
    if (!directory)
        return null;
    // The whole probe is inside the try: any throw means "not known".
    try {
        const workspaceId = client_1.workspaceContext.getStore() ?? client.getWorkspaceId();
        if (!workspaceId)
            return null;
        const kinds = await directory.containerKindIndex();
        return kinds.get(workspaceId) === "home_channel" ? workspaceId : null;
    }
    catch {
        return null;
    }
}
/**
 * Does this call land in the caller's Home space? Unbound and unlocked = yes: the server resolves
 * the caller's Home. Any doubt answers false, and the server's fence then refuses by name.
 */
async function landsInHomeSpace(client, directory) {
    try {
        if (directory.lockedWorkspaceId() !== null)
            return false;
        const workspaceId = client_1.workspaceContext.getStore() ?? client.getWorkspaceId();
        if (!workspaceId)
            return true;
        return (await directory.containerKindIndex()).get(workspaceId) === "home";
    }
    catch {
        return false;
    }
}
/**
 * The one channel in a home-channel container, or null: two would be unresolvable, never picked.
 * The filter is the positive `container.kind === "link"` plus an exact container id (F-564).
 */
async function resolveHomeChannelId(client, containerId) {
    try {
        const { channels } = await client.getHomeChannels();
        const matches = channels.filter((c) => c.workspaceId === containerId && c.container?.kind === "link");
        return matches.length === 1 ? matches[0].id : null;
    }
    catch {
        return null;
    }
}
/** Destination 2's channel for the knowledge write lane, or `undefined` = send no grant (the server then refuses by name). */
async function resolveChannelShareTarget(client, directory) {
    const container = await resolveHomeChannelContainer(client, directory);
    if (!container)
        return undefined;
    return (await resolveHomeChannelId(client, container)) ?? undefined;
}
