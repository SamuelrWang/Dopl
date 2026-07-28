"use strict";
/**
 * `dopl_channel` WRITE op handlers: open (create a channel or direct message),
 * invite (add a workspace member), post (send a message or task-activity
 * event), and the first-class task ops (create_task / close_task /
 * set_task_mode). Maps @dopl/client 4xx collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opOpen = opOpen;
exports.opInvite = opInvite;
exports.opPost = opPost;
exports.opCreateTask = opCreateTask;
exports.opCloseTask = opCloseTask;
exports.opSetTaskMode = opSetTaskMode;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
function isBadRequest(e) {
    return (typeof e === "object" && e !== null && e.status === 400);
}
/** Duck-typed HTTP 403 from the Dopl API (task authorization refusals). */
function isForbidden(e) {
    return (typeof e === "object" && e !== null && e.status === 403);
}
async function opOpen(client, opts) {
    // Direct branch: open (or dedup-return) a 1:1 channel with `member`. The
    // server dedups a repeat DM to the same peer, so this is idempotent.
    if (opts.direct) {
        const member = await (0, channel_shared_1.resolveMemberOr)(client, opts.member);
        if ((0, channel_shared_1.isErr)(member))
            return member;
        const channel = await client.createChannel({
            direct: true,
            memberUserId: member.userId,
        });
        return (0, respond_1.ok)([
            `Opened a direct message with ${member.label} (id: \`${channel.id}\` · slug: \`${channel.slug}\`).`,
            `Post with dopl_channel(op="post", channel="${channel.id}", body="...").`,
        ].join("\n"));
    }
    const name = opts.name;
    let channel;
    try {
        channel = await client.createChannel({
            name,
            topic: opts.topic,
            visibility: opts.visibility,
        });
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
    // Thread the post under a task when `task` is passed: fold the id into
    // `metadata.taskId` (the explicit param wins over any metadata copy). The
    // route then server-validates it resolves to a task in this channel.
    const metadata = opts.task
        ? { ...(opts.metadata ?? {}), taskId: opts.task }
        : opts.metadata;
    let message;
    try {
        message = await client.postChannelMessage(ch.id, {
            body,
            kind: opts.kind,
            metadata,
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
// ─── Tasks ──────────────────────────────────────────────────────────
async function opCreateTask(client, channelRef, title, body, to, mode) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const member = await (0, channel_shared_1.resolveMemberOr)(client, to);
    if ((0, channel_shared_1.isErr)(member))
        return member;
    let task;
    try {
        task = await client.createChannelTask(ch.id, {
            title,
            body,
            toUserId: member.userId,
            mode,
        });
    }
    catch (e) {
        // The route rejects an addressee who isn't a channel member (400).
        if (isBadRequest(e)) {
            return (0, respond_1.err)(`Couldn't address the task to ${member.label} — they aren't a member of **${ch.name}**. Invite them first (op="invite"), then create the task.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Created task **${task.title}** in **${ch.name}** (task \`${task.id}\`, ${task.mode} mode), addressed to ${member.label}. Watch for replies with dopl_channel(op="await", channel="${ch.id}", since=<last seq>).`);
}
async function opCloseTask(client, channelRef, taskId, outcome, summary) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    let task;
    try {
        task = await client.closeChannelTask(ch.id, taskId, { outcome, summary });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No task \`${taskId}\` in **${ch.name}**.`);
        }
        if (isForbidden(e)) {
            return (0, respond_1.err)(`You can't close task \`${taskId}\` — only its creator or the member it's addressed to may close it.`);
        }
        throw e;
    }
    const summaryNote = summary?.trim() ? ` — ${summary.trim()}` : "";
    return (0, respond_1.ok)(`Closed task **${task.title}** in **${ch.name}** as ${task.outcome}${summaryNote}.`);
}
async function opSetTaskMode(client, channelRef, taskId, mode) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    let task;
    try {
        task = await client.setChannelTaskMode(ch.id, taskId, { mode });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No task \`${taskId}\` in **${ch.name}**.`);
        }
        if (isForbidden(e)) {
            return (0, respond_1.err)(`You can't change the mode of task \`${taskId}\` — only its creator can.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Set task **${task.title}** in **${ch.name}** to ${task.mode} mode.`);
}
