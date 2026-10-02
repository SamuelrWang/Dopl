"use strict";
/**
 * channel-home-rooms.ts — channels as seen from the HOME SPACE.
 *
 * ⚠ **HOME HOLDS NO CHANNELS** (1.37.1): every home channel is its own `kind='link'`
 * container. So a connection that names no container (it lands in `home`) listed
 * nothing and 404'd every channel ref — and the list told the agent to create a
 * channel, which mints a duplicate. This module gives that connection the same set
 * /home's sidebar shows, from the same read (`getHomeChannels` = `GET
 * /api/channels?scope=account`, filtered to `link` containers), and routes a channel
 * ref onto the container that owns it.
 *
 * 🔒 Only when `landsInHomeSpace` says so: a container-LOCKED session never stands
 * in Home, so this cannot enumerate the operator's other rooms (B3). No row is
 * copied or re-homed — it only addresses the channel where it already lives
 * (two-destination model).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.homeRooms = homeRooms;
exports.routeHomeChannel = routeHomeChannel;
exports.channelListFooter = channelListFooter;
exports.formatHomeList = formatHomeList;
const client_1 = require("@dopl/client");
const workspace_directory_js_1 = require("../workspace-directory.js");
const container_destination_js_1 = require("./container-destination.js");
const call_ref_js_1 = require("../call-ref.js");
const channel_render_1 = require("./channel-render");
const respond_1 = require("./respond");
/**
 * The account list, split for a Home-space caller; `null` when this call does not
 * land in Home (the ordinary container list answers it).
 */
async function homeRooms(client, directory) {
    if (!directory || !(await (0, container_destination_js_1.landsInHomeSpace)(client, directory)))
        return null;
    const payload = await client.getHomeChannels();
    const channels = payload.channels ?? [];
    const home = channels.filter((c) => c.container?.kind === "link");
    const counts = new Map();
    for (const c of channels) {
        if (c.container?.kind !== "standard")
            continue;
        counts.set(c.container.id, (counts.get(c.container.id) ?? 0) + 1);
    }
    const rows = (await directory.getWorkspaceList().catch(() => [])).filter((w) => (0, workspace_directory_js_1.containerKind)(w) === "workspace");
    const slugUses = new Map();
    for (const w of rows)
        slugUses.set(w.slug, (slugUses.get(w.slug) ?? 0) + 1);
    const workspaces = [...counts].map(([id, count]) => {
        const row = rows.find((w) => w.id === id);
        // A slug two rows share is refused as an address (F-719), so print the id.
        const address = row && slugUses.get(row.slug) === 1 ? row.slug : id;
        return { address, count };
    });
    return { home, workspaces, truncated: payload.truncated ?? false };
}
/**
 * Run a channel op on the home-channel container that owns `ref`, when this call
 * lands in Home. Home itself holds no channel, so without this every ref 404s
 * there. An id or unique slug routes; a slug two home channels share is refused
 * naming both ids; no match runs unchanged (the route's own not-found answers).
 */
async function routeHomeChannel(client, directory, ref, run) {
    const wanted = ref?.trim();
    if (!wanted || !(await (0, container_destination_js_1.landsInHomeSpace)(client, directory)))
        return run();
    let channels;
    try {
        channels = (await client.getHomeChannels()).channels ?? [];
    }
    catch {
        return run();
    }
    const home = channels.filter((c) => c.container?.kind === "link");
    const byId = home.find((c) => c.id === wanted);
    const matches = byId ? [byId] : home.filter((c) => c.slug === wanted);
    if (matches.length > 1) {
        return (0, respond_1.err)(`Channel "${wanted}" names ${matches.length} of your home channels — pass its id instead: ${matches
            .map((c) => `\`${c.id}\``)
            .join(", ")}. Nothing was done.`);
    }
    const owner = matches[0]?.container?.id;
    return owner ? client_1.workspaceContext.run(owner, run) : run();
}
/** The list's closing line — how to read, post and wait. One spelling for both lists. */
function channelListFooter() {
    return `\nRead a channel with ${(0, call_ref_js_1.callRef)("channel.read", { channel: "<slug|id>" })}; post with ${(0, call_ref_js_1.callRef)("channel.send", {}, { form: "op" })}; WAIT for new ones by HOLDING — ${(0, call_ref_js_1.callRef)("channel.read", {}, { form: "op" })} with wait_ms, never a timed re-read.`;
}
/** The Home-space list: home channels, then ONE line naming the workspaces that hold more. */
function formatHomeList({ home, workspaces, truncated }) {
    if (home.length === 0 && workspaces.length === 0) {
        return (0, respond_1.ok)(`No channels yet. Create one with ${(0, call_ref_js_1.callRef)("channel.rooms.open", { name: '"..."' })}.`);
    }
    const lines = [
        home.length === 0
            ? `No home channels.`
            : `## Home channels — ${home.length}${truncated ? " (clipped)" : ""}\n`,
    ];
    for (const c of home)
        lines.push((0, channel_render_1.formatChannelLine)(c));
    if (workspaces.length > 0) {
        const named = workspaces.map((w) => `\`${w.address}\` (${w.count})`).join(", ");
        lines.push(`\nWorkspace channels — list with container=<slug>: ${named}.`);
    }
    if (home.length > 0)
        lines.push(channelListFooter());
    return (0, respond_1.ok)(lines.join("\n"));
}
