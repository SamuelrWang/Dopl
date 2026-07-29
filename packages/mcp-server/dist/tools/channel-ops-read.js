"use strict";
/**
 * `dopl_channel` READ op handlers: list (channels), read (messages), await
 * (long-poll for new messages). All non-mutating. Routed from the
 * registrar in channel.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opRead = opRead;
exports.opAwait = opAwait;
exports.opListTasks = opListTasks;
exports.opGetTask = opGetTask;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
/**
 * Author label for a message line. Makes an agent's OPERATOR explicit — an
 * `agent` row renders "agent for <name>", never a bare name — so a reader
 * treats the counterparty as another member's agent, not its own operator.
 *   - system → "system"
 *   - agent  → "agent for <name>" (fallback: "agent for `<id>`" → "an agent")
 *   - user   → "<name>" (fallback: "user `<id>`" → the kind)
 */
function formatAuthor(m) {
    if (m.authorKind === "system")
        return "system";
    const name = m.authorName?.trim();
    if (m.authorKind === "agent") {
        return name
            ? `agent for ${name}`
            : m.authorUserId
                ? `agent for \`${m.authorUserId}\``
                : "an agent";
    }
    return name ? name : m.authorUserId ? `user \`${m.authorUserId}\`` : m.authorKind;
}
/**
 * One rendered message line. `task_*` events already carry a
 * human-readable render in `body` (per the data model), so the listing
 * needs no per-kind special-casing — just tag non-chat kinds.
 */
function formatMessage(m) {
    const author = formatAuthor(m);
    const kindTag = m.kind !== "message" ? ` · ${m.kind}` : "";
    const head = `**#${m.seq}** ${author}${kindTag} · ${m.createdAt}`;
    const body = m.body ? `\n  ${m.body.replace(/\n/g, "\n  ")}` : "";
    return `- ${head}${body}`;
}
/**
 * One rendered task line for `list_tasks`. A task is the authoritative
 * status/mode store; its transcript rides on the channel's messages, so this
 * summarizes the row and points the reader at `read`/`get_task` for detail.
 */
function formatTaskLine(t) {
    const bits = [`\`${t.id}\``, t.status, `${t.mode} mode`];
    if (t.outcome)
        bits.push(`outcome ${t.outcome}`);
    if (t.targetUserId)
        bits.push(`for \`${t.targetUserId}\``);
    const summary = t.outcomeSummary ? ` — ${t.outcomeSummary}` : "";
    return `- **${t.title}** (${bits.join(" · ")})${summary}`;
}
/** Multi-line detail block for a single task (`get_task`). */
function formatTaskDetail(t) {
    const lines = [
        `## Task ${t.title}`,
        ``,
        `- id: \`${t.id}\``,
        `- status: ${t.status}${t.outcome ? ` (${t.outcome})` : ""}`,
        `- mode: ${t.mode}`,
        `- created by: \`${t.createdBy}\``,
        `- addressed to: ${t.targetUserId ? `\`${t.targetUserId}\`` : "(unaddressed)"}`,
        `- created: ${t.createdAt}`,
        `- updated: ${t.updatedAt}`,
    ];
    if (t.closedAt)
        lines.push(`- closed: ${t.closedAt}`);
    if (t.outcomeSummary)
        lines.push(`- outcome summary: ${t.outcomeSummary}`);
    return lines.join("\n");
}
async function opList(client) {
    const channels = await client.listChannels();
    if (channels.length === 0) {
        return (0, respond_1.ok)('No channels yet. Create one with dopl_channel(op="open", name="...").');
    }
    const lines = [`## Channels — ${channels.length}\n`];
    for (const c of channels) {
        const bits = [`id: \`${c.id}\``, c.visibility];
        if (c.memberCount !== undefined) {
            bits.push(`${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`);
        }
        if (c.lastMessageAt)
            bits.push(`last activity ${c.lastMessageAt}`);
        const topic = c.topic ? ` — ${c.topic}` : "";
        lines.push(`- **${c.name}** (slug: \`${c.slug}\` · ${bits.join(" · ")})${topic}`);
    }
    lines.push('\nRead a channel with dopl_channel(op="read", channel=<slug|id>); post with op="post"; watch for new messages with op="await".');
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opRead(client, ref, since, limit) {
    // Hot path — no pre-resolve. The route accepts slug-or-id in the
    // [channelId] segment and enforces visibility itself, so we hand it the
    // caller's ref directly and skip a per-call listChannels() round-trip. A
    // route 404 (unknown ref, or one the caller can't see) maps to a clean
    // not-found; the ref stands in for the channel name in the output.
    let messages;
    try {
        messages = await client.readChannelMessages(ref, { since, limit });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (messages.length === 0) {
        const sinceNote = since !== undefined ? ` after seq ${since}` : "";
        return (0, respond_1.ok)(`No messages in **${ref}**${sinceNote}. Watch for new ones with dopl_channel(op="await", channel="${ref}", since=${since ?? 0}).`);
    }
    const lines = [
        `## ${ref} — ${messages.length} message${messages.length === 1 ? "" : "s"}\n`,
    ];
    for (const m of messages)
        lines.push(formatMessage(m));
    const lastSeq = messages[messages.length - 1].seq;
    lines.push(`\nHighest seq shown: ${lastSeq}. Watch for newer messages with dopl_channel(op="await", channel="${ref}", since=${lastSeq}).`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opAwait(client, ref, since, timeoutMs) {
    // Hot path — same rationale as opRead, and this one runs inside the
    // listener's poll loop, so the saved round-trip compounds per cycle. Pass
    // the ref straight through; map a route 404 to a clean not-found.
    let result;
    try {
        result = await client.awaitChannelMessages(ref, { since, timeoutMs });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (result.messages.length === 0) {
        return (0, respond_1.ok)(`No new messages in **${ref}** since seq ${since} (the poll timed out). Re-call dopl_channel(op="await", channel="${ref}", since=${since}) to keep watching.`);
    }
    const lines = [
        `## ${ref} — ${result.messages.length} new message${result.messages.length === 1 ? "" : "s"} since seq ${since}\n`,
    ];
    for (const m of result.messages)
        lines.push(formatMessage(m));
    const lastSeq = result.messages[result.messages.length - 1].seq;
    lines.push(`\nAdvance your cursor to seq ${lastSeq}, then re-call dopl_channel(op="await", channel="${ref}", since=${lastSeq}) to keep watching.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opListTasks(client, ref) {
    // Hot-path parity with read/await: hand the ref straight to the route
    // (slug-or-id + visibility enforced there) and map a 404 to a clean
    // not-found, rather than pre-resolving via listChannels.
    let tasks;
    try {
        tasks = await client.listChannelTasks(ref);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (tasks.length === 0) {
        return (0, respond_1.ok)(`No tasks in **${ref}**. Open one with dopl_channel(op="create_task", channel="${ref}", title="...", body="...", to="...").`);
    }
    const lines = [
        `## ${ref} — ${tasks.length} task${tasks.length === 1 ? "" : "s"}\n`,
    ];
    for (const t of tasks)
        lines.push(formatTaskLine(t));
    lines.push(`\nInspect one with dopl_channel(op="get_task", channel="${ref}", task=<id>); read its thread with op="read".`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGetTask(client, ref, taskId) {
    let task;
    try {
        task = await client.getChannelTask(ref, taskId);
    }
    catch (e) {
        // The route 404s both an unknown channel ref and a task not in this
        // channel; surface a task-oriented not-found either way.
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No task \`${taskId}\` in **${ref}**. List a channel's tasks with dopl_channel(op="list_tasks", channel="${ref}").`);
        }
        throw e;
    }
    return (0, respond_1.ok)(formatTaskDetail(task));
}
