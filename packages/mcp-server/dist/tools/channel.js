"use strict";
/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one shared exchange
 * between two members; a SESSION is one member's agent run working it. Agents
 * (and users) post messages and structured activity events, then long-poll
 * for replies. Every message has a monotonic `seq` cursor, so a listener can
 * ask for "everything after seq N" (op="read"/"await").
 *
 * This file is the thin registrar: it owns the single tool schema + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `channel-shared.ts`    — channel + member reference resolution
 *   - `channel-ops-read.ts`  — list / read / await / list_threads / get_thread
 *   - `channel-ops-write.ts` — open / invite / post / create_thread / close_thread / set_thread_mode
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The ops
 * and params here say `thread`; `channel_tasks`, `metadata.taskId`, the
 * `task_*` message kinds and the `/tasks` routes keep the storage name.
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChannelTool = registerChannelTool;
const zod_1 = require("zod");
const respond_1 = require("./respond");
// FIX M3 — the advertised cap, the schema's `.max()` and the number in the
// description all read ONE constant. They were three literals, and the cap had
// already drifted past the margin the deadline chain asserts (240s + a 60s
// margin is exactly the route's 300s ceiling, i.e. no margin at all).
const channel_await_budget_1 = require("./channel-await-budget");
const channel_ops_read_1 = require("./channel-ops-read");
const channel_ops_write_1 = require("./channel-ops-write");
const CHANNEL_DESCRIPTION = `Cross-user collaboration channels, where you and other members' agents work together.

THE MODEL:
A CHANNEL (or DM) holds many THREADS.
A THREAD is ONE exchange between two members about one thing. It may be a single message or a long piece of work. It is SHARED: both members see the same thread, its title, and its status.
A SESSION is ONE member's agent run working a thread, on THAT member's machine. Each side has its own session. A session pauses and resumes; a thread does not. You never see the other member's session, only the messages it sends.

THE PROTOCOL: open a thread with "create_thread", or find an existing one with "list_threads". Post into the channel threading every message with that thread id (\`thread=<id>\`) so both sides read one exchange. Post progress as it lands, not in one dump at the end. Close the thread with "close_thread" when the GOAL is done, not per hop.

Every message has a monotonic \`seq\` cursor: \`read\`/\`await\` take \`since\`=a seq and return messages with a HIGHER seq, in order. Set \`op\` to one of:
- "list" — list the channels you can see in the active workspace (name, slug, id, visibility, member count, last activity). Start here to find a channel's slug or id.
- "open" — create a channel, OR open a direct (1:1) message. For a channel: requires name; optional topic, visibility ("private" default = invite-only, or "public" = visible to the whole workspace); you become its owner. For a direct message: pass \`direct\`=true + \`member\` (an email or user id of an active workspace member) and no name — it opens, or reuses, a private 1:1 channel with that member.
- "invite" — add a workspace member to a channel. Requires: channel (slug or id) + member (an email or user id — must be an ACTIVE member of this workspace; invites are in-workspace only). You must already belong to the channel.
- "post" — post to a channel. Requires: channel + body. ALWAYS pass \`summary\`: a short one-line intent (<=200 chars) that becomes the notification the other member sees. Pass \`to\` (an email or user id of a channel member) when your message is a request aimed at one specific person's agent — that member's listener is then the only one triggered; leave it off for general chat or broadcasts. In a DIRECT (1:1) channel you do not need \`to\`: your post is addressed to the other member automatically, so a reply always reaches them. In a channel with three or more members nothing is assumed, so \`to\` is still how you address one specific member. Pass \`thread\` (a thread id) to thread this post into that thread's card; a \`kind="task_progress"\` post with \`thread=<id>\` logs one concrete milestone (an accomplishment that just landed) on the thread. Optional: kind (default "message" = chat; "task_started" / "task_progress" / "task_finished" / "task_failed" = structured activity events, which keep the older \`task_\` storage names — put the machine-readable payload in \`metadata\` and a human-readable one-liner in \`body\` so the exchange stays readable), metadata (a JSON object, e.g. {taskId, status, durationMs, refs}), client_msg_id (idempotency key — re-posting with the same id won't duplicate). The result tells you how the post LANDED — "THREADED into <title>", or "NOT THREADED" plus the channel's open thread ids; read that line, because an untagged post reads as a brand-new request on the other side.
- "read" — read a channel's recent messages, ascending by seq. Requires: channel. Optional: since (return only messages after this seq), limit (max 200). Note the highest seq to use as your next \`since\`. Each line shows its thread linkage ("· thread <short id>", or "· no thread"), with the short tags expanded to full ids underneath — that is how you tell a continuation from a new request.
- "await" — LONG-POLL for new messages, and the ONLY thing that brings a reply back to you when nothing else feeds you: it blocks up to ~3.5 minutes waiting for a message with seq > since, returning the moment one arrives (or nothing, on timeout). Requires: channel + since (the last seq you've processed). Optional: timeout_ms (total hold in milliseconds, <=${channel_await_budget_1.AWAIT_HOLD_CAP_MS}, default ${channel_await_budget_1.AWAIT_HOLD_DEFAULT_MS}). CALL IT BEFORE YOU END YOUR TURN whenever you are waiting on a reply — a call this long keeps running in the background after your turn ends, and its result WAKES you with the reply. On wake: handle what arrived, then call "await" again with the new highest seq to keep listening. On a timeout with no messages: call "await" again with the SAME since — a peer agent doing real work is often quiet for a long stretch, so a timeout is not an answer. Every ~3 empty holds in a row, check before re-arming ("get_thread" for status, "read" for new task_progress milestones): keep waiting while the thread is OPEN and the peer showed activity in roughly the last 30 minutes; STOP and report to your operator when the thread is closed or failed, or when nothing has come from them for ~30+ minutes. Also stop if a hold comes back far sooner than it asked for (the result says so): short holds cannot wake you, so report that instead of looping on them. (Not for a desktop session window — see the listener note below.)
- "list_threads" — list a channel's threads (id, title, status, mode, outcome, outcome summary, created-by, addressed-to). Requires: channel. Start here to find a thread's id; read its messages with "read" or inspect one with "get_thread".
- "get_thread" — inspect one thread by id (its status, mode, outcome, outcome summary, who it is addressed to, and timestamps). Requires: channel + thread (the thread id).
- "create_thread" — open a thread in a channel: one titled, tracked exchange addressed to one member. Requires: channel + title + body (the request, posted as the thread's first message) + to (the member the thread is for). Optional: mode ("interactive" default, or "autonomous"); client_msg_id (idempotency key — retrying create_thread with the same id returns the existing thread instead of opening a second). Returns the thread id; the responder's replies stream back via "await". Then thread every related post with \`thread=<id>\` and log each concrete accomplishment as a milestone (kind="task_progress", thread=<id>) the moment it lands; the requester closes the thread with "close_thread" (optionally a \`summary\`) when the GOAL is done — not per hop.
- "close_thread" — close a thread. Requires: channel + thread (the thread id) + outcome ("completed" or "failed"). Optional: summary (a one-line outcome, <=2000 chars) shown on the thread card and carried in the close echo. Allowed for the thread's creator or the member it is addressed to. Close when the multi-step GOAL completes, not per hop.
- "set_thread_mode" — change a thread's execution mode. Requires: channel + thread + mode ("interactive" or "autonomous"). Creator only — the mode governs the creator's own machine.

Watching a channel as a listener: first "read" (or "list") to learn the latest seq, then loop — call "await" with since=<last seq you saw>. If it comes back with no messages (timed out), just re-call "await" with the SAME since; every ~3 empty holds, check the thread's status and recent messages before re-arming, and stop once it is closed or the peer has been silent for ~30+ minutes. When it returns messages, process them, advance your cursor to the HIGHEST seq returned, and re-call "await" with since=<that seq>. Each "await" is one bounded call; re-issue it to keep listening, and re-issue it BEFORE you end a turn while you are still expecting something — the pending call is what wakes you when the message lands. BUT if the counterparty's replies are already arriving to you as new turns (a desktop-run session window that feeds them in), do NOT call "await" at all — await is only for a standalone listener loop where nothing else feeds you.

WHAT A CHANNEL CALL COSTS. Running inside a live desktop session window, EVERY dopl_channel op may stop and wait for your operator to approve it. That includes a plain "post" into this session's own channel: own-channel posts were pre-approved in older builds, and they are NOT any more. Your operator also has a per-session Messages setting that can send your posts (and accept inbound replies) automatically, so some calls will go through with no click. You cannot tell which case you are in, and any approval you were granted is per-session and is dropped when the session is paused. So plan for every channel call to cost a human decision: say a whole thought in one post instead of three, thread it with \`thread=<id>\`, and do not treat posting as free.

Channel counterparties are typically other members' AI agents acting for their operator. A blocker on YOUR OWN machine (a missing tool permission, folder access, or sign-in) is yours to resolve with your own operator — report it as your side being blocked; never ask the counterparty to change your machine.`;
function registerChannelTool(register, client) {
    register("dopl_channel", CHANNEL_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list",
            "open",
            "invite",
            "post",
            "read",
            "await",
            "list_threads",
            "get_thread",
            "create_thread",
            "close_thread",
            "set_thread_mode",
        ])
            .describe("Operation to perform."),
        channel: zod_1.z
            .string()
            .optional()
            .describe('Channel slug or id. Required for invite/post/read/await/list_threads/get_thread/create_thread/close_thread/set_thread_mode. (op="open" creates a new channel and needs no channel; op="list" lists them all.)'),
        direct: zod_1.z
            .boolean()
            .optional()
            .describe('op="open": set true to open a direct (1:1) message instead of a named channel — pass `member` (no name). Reuses the existing DM if one already exists.'),
        name: zod_1.z
            .string()
            .optional()
            .describe('op="open" (required for a channel; omit for a direct message): the channel name (1-120 chars).'),
        topic: zod_1.z
            .string()
            .optional()
            .describe('op="open": optional one-line topic / purpose for the channel.'),
        visibility: zod_1.z
            .enum(["private", "public"])
            .optional()
            .describe('op="open": "private" (default, invite-only) or "public" (any workspace member can see and join).'),
        member: zod_1.z
            .string()
            .optional()
            .describe('op="invite" (required) / op="open" with direct=true (required): the member — an email or user id of an ACTIVE workspace member.'),
        body: zod_1.z
            .string()
            .optional()
            .describe('op="post" / op="create_thread" (required): the message text. For a task_* kind, put a human-readable one-liner here and the structured payload in metadata. For create_thread, this is the requester\'s initial request.'),
        to: zod_1.z
            .string()
            .optional()
            .describe('op="post" / op="create_thread" (required for create_thread): address to one channel member — an email or user id (resolved like invite\'s member). For post, use it when the message is a request for that specific person\'s agent; omit for general chat / broadcasts. For create_thread, it is the member the thread is for.'),
        summary: zod_1.z
            .string()
            .optional()
            .describe('op="post": a short one-line intent (<=200 chars). ALWAYS set it — it becomes the notification the receiving member sees. op="close_thread" (optional): a one-line outcome summary (<=2000 chars) shown on the thread card and carried in the close echo.'),
        kind: zod_1.z
            .enum([
            "message",
            "task_started",
            "task_progress",
            "task_finished",
            "task_failed",
        ])
            .optional()
            .describe('op="post": message kind — "message" (default, chat) or a structured activity event ("task_started" / "task_progress" / "task_finished" / "task_failed"; these keep the older `task_` storage names).'),
        metadata: zod_1.z
            .record(zod_1.z.string(), zod_1.z.unknown())
            .optional()
            .describe('op="post": optional JSON object of structured fields for task_* events (e.g. {taskId, status, durationMs, refs}).'),
        client_msg_id: zod_1.z
            .string()
            .optional()
            .describe('op="post" / op="create_thread": optional idempotency key — re-sending the same op with the same id won\'t create a duplicate (a repeat create_thread returns the already-created thread instead of opening a second).'),
        title: zod_1.z
            .string()
            .optional()
            .describe('op="create_thread" (required): the thread title (1-200 chars) — a short header for the exchange.'),
        mode: zod_1.z
            .enum(["interactive", "autonomous"])
            .optional()
            .describe('op="create_thread" (optional, default "interactive") / op="set_thread_mode" (required): the thread execution mode.'),
        thread: zod_1.z
            .string()
            .optional()
            .describe('op="get_thread" / op="close_thread" / op="set_thread_mode" (required): the thread id (returned by create_thread). op="post" (optional): thread this post under that thread — logs a milestone when combined with kind="task_progress".'),
        outcome: zod_1.z
            .enum(["completed", "failed"])
            .optional()
            .describe('op="close_thread" (required): how the thread ended.'),
        // coerce: MCP clients sometimes send numbers as strings; strict
        // z.number() rejects them with an opaque -32602.
        since: zod_1.z.coerce
            .number()
            .int()
            .min(0)
            .optional()
            .describe('op="read": return only messages with seq greater than this. op="await" (required): the last seq you have processed.'),
        limit: zod_1.z.coerce
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe('op="read": max messages to return (1-200).'),
        timeout_ms: zod_1.z.coerce
            .number()
            .int()
            .min(0)
            .max(channel_await_budget_1.AWAIT_HOLD_CAP_MS)
            .optional()
            .describe(`op="await": TOTAL time to hold before returning with no messages (milliseconds, max ${channel_await_budget_1.AWAIT_HOLD_CAP_MS}; defaults to ${channel_await_budget_1.AWAIT_HOLD_DEFAULT_MS} when omitted). The hold is assembled server-side out of ~50s polls re-issued with the same cursor, so it returns the instant a message arrives. Leave it unset unless you deliberately want a short check — the long default is what lets the pending call wake you. If a long hold comes back as a raw transport timeout instead of a result, your own MCP client is capping the call: report that to your operator and fall back to timeout_ms=50000 plus repeated op="read".`),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return (0, channel_ops_read_1.opList)(client);
            case "open": {
                if (args.direct) {
                    const miss = (0, respond_1.missingParams)("open", args, ["member"]);
                    if (miss)
                        return miss;
                    return (0, channel_ops_write_1.opOpen)(client, { direct: true, member: args.member });
                }
                const miss = (0, respond_1.missingParams)("open", args, ["name"]);
                if (miss)
                    return miss;
                return (0, channel_ops_write_1.opOpen)(client, {
                    name: args.name,
                    topic: args.topic,
                    visibility: args.visibility,
                });
            }
            case "invite": {
                const miss = (0, respond_1.missingParams)("invite", args, ["channel", "member"]);
                if (miss)
                    return miss;
                return (0, channel_ops_write_1.opInvite)(client, args.channel, args.member);
            }
            case "post": {
                const miss = (0, respond_1.missingParams)("post", args, ["channel", "body"]);
                if (miss)
                    return miss;
                return (0, channel_ops_write_1.opPost)(client, args.channel, args.body, {
                    kind: args.kind,
                    metadata: args.metadata,
                    clientMsgId: args.client_msg_id,
                    to: args.to,
                    summary: args.summary,
                    thread: args.thread,
                });
            }
            case "read": {
                const miss = (0, respond_1.missingParams)("read", args, ["channel"]);
                if (miss)
                    return miss;
                return (0, channel_ops_read_1.opRead)(client, args.channel, args.since, args.limit);
            }
            case "await": {
                const miss = (0, respond_1.missingParams)("await", args, ["channel", "since"]);
                if (miss)
                    return miss;
                return (0, channel_ops_read_1.opAwait)(client, args.channel, args.since, args.timeout_ms);
            }
            case "list_threads": {
                const miss = (0, respond_1.missingParams)("list_threads", args, ["channel"]);
                if (miss)
                    return miss;
                return (0, channel_ops_read_1.opListThreads)(client, args.channel);
            }
            case "get_thread": {
                const miss = (0, respond_1.missingParams)("get_thread", args, ["channel", "thread"]);
                if (miss)
                    return miss;
                return (0, channel_ops_read_1.opGetThread)(client, args.channel, args.thread);
            }
            case "create_thread": {
                const miss = (0, respond_1.missingParams)("create_thread", args, [
                    "channel",
                    "title",
                    "body",
                    "to",
                ]);
                if (miss)
                    return miss;
                return (0, channel_ops_write_1.opCreateThread)(client, args.channel, args.title, args.body, args.to, args.mode, args.client_msg_id);
            }
            case "close_thread": {
                const miss = (0, respond_1.missingParams)("close_thread", args, [
                    "channel",
                    "thread",
                    "outcome",
                ]);
                if (miss)
                    return miss;
                return (0, channel_ops_write_1.opCloseThread)(client, args.channel, args.thread, args.outcome, args.summary);
            }
            case "set_thread_mode": {
                const miss = (0, respond_1.missingParams)("set_thread_mode", args, [
                    "channel",
                    "thread",
                    "mode",
                ]);
                if (miss)
                    return miss;
                return (0, channel_ops_write_1.opSetThreadMode)(client, args.channel, args.thread, args.mode);
            }
        }
    });
}
