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
/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
function isBadRequest(e) {
    return (typeof e === "object" && e !== null && e.status === 400);
}
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
async function opPost(client, channelRef, body, opts = {}) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    // Resolve the addressee reference (email or user id) like invite does —
    // to a workspace member. The route then enforces channel membership.
    let toUserId;
    let toLabel;
    if (opts.to) {
        const member = await (0, channel_shared_1.resolveMemberOr)(client, opts.to);
        if ((0, channel_shared_1.isErr)(member))
            return member;
        toUserId = member.userId;
        toLabel = member.label;
    }
    let message;
    try {
        message = await client.postChannelMessage(ch.id, {
            body,
            kind: opts.kind,
            metadata: opts.metadata,
            clientMsgId: opts.clientMsgId,
            toUserId,
            summary: opts.summary,
        });
    }
    catch (e) {
        // The route rejects an addressee who isn't a channel member (400).
        if (toUserId && isBadRequest(e)) {
            return (0, respond_1.err)(`Couldn't address the message to ${toLabel} — they aren't a member of **${ch.name}**. Invite them first (op="invite"), or post without \`to\`.`);
        }
        throw e;
    }
    const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
    const toNote = toLabel ? `, addressed to ${toLabel}` : "";
    return (0, respond_1.ok)(`Posted to **${ch.name}** (message \`${message.id}\`, seq ${message.seq}${kindNote}${toNote}). Readers watching with op="await" will pick it up.`);
}
