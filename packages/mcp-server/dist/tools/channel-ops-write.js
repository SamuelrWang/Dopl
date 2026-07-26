"use strict";
/**
 * `dopl_channel` WRITE op handlers: open (create a channel), invite (add a
 * workspace member), post (send a message or task-activity event). Maps
 * @dopl/client already-exists (409) collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opOpen = opOpen;
exports.opInvite = opInvite;
exports.opPost = opPost;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
async function opOpen(client, name, topic, visibility) {
    let channel;
    try {
        channel = await client.createChannel({ name, topic, visibility });
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            // NOT a duplicate-name collision: duplicate names auto-dedupe via slug
            // suffixing. A 409 here is a transient same-derived-slug insert race
            // between two concurrent opens — nothing was created, and a retry
            // (which derives the next free slug) succeeds.
            return (0, respond_1.err)(`Hit a transient naming conflict creating "${name}" (a rare concurrent-open race on the derived slug). Nothing was created — just retry the same open and it should succeed.`);
        }
        throw e;
    }
    const visNote = channel.visibility === "private"
        ? "Private — only invited members can see it."
        : "Public — visible to the whole workspace.";
    return (0, respond_1.ok)([
        `Created channel **${channel.name}** (slug: \`${channel.slug}\` · id: \`${channel.id}\`). ${visNote}`,
        `Post with dopl_channel(op="post", channel="${channel.slug}", body="..."); add members with op="invite".`,
    ].join("\n"));
}
async function opInvite(client, channelRef, memberRef) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const member = await (0, channel_shared_1.resolveMemberOr)(client, memberRef);
    if ((0, channel_shared_1.isErr)(member))
        return member;
    let added;
    try {
        added = await client.inviteToChannel(ch.id, member.userId);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`${member.label} is already a member of **${ch.name}**.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Added ${member.label} to **${ch.name}** as ${added.role}.`);
}
async function opPost(client, channelRef, body, kind, metadata, clientMsgId) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const message = await client.postChannelMessage(ch.id, {
        body,
        kind,
        metadata,
        clientMsgId,
    });
    const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
    return (0, respond_1.ok)(`Posted to **${ch.name}** (message \`${message.id}\`, seq ${message.seq}${kindNote}). Readers watching with op="await" will pick it up.`);
}
