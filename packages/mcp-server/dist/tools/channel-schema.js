"use strict";
/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional
 * params, plus the `op` discriminator, with the per-op requirements enforced at
 * runtime by `missingParams` in the registrar.
 *
 * Split out of `channel.ts` at the §2 500-line cap alongside
 * `channel-description.ts`. The seam is the same one: this is the DECLARED
 * SURFACE an MCP client introspects (names, types, caps, and the prose that
 * teaches each param), while the registrar is routing. The parity suite reads
 * both — every declared param must be referenced by some handler in the
 * `channel-*` group, and no handler may read an arg that is not declared here.
 *
 * The caps below MIRROR the routes' own zod schemas
 * (src/features/channels/schema.ts): title 200, body 16000, summary 2000 (the
 * tighter 200 applies to a post's summary), client_msg_id 200. Declared here
 * they are published in the tool's inputSchema (the model sees a maxLength) and
 * enforced before the call is made at all. `.trim()` where — and only where —
 * the route trims before measuring, so the two agree on what "200 characters"
 * counts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_INPUT_SHAPE = void 0;
const zod_1 = require("zod");
const channel_await_budget_1 = require("./channel-await-budget");
// The status enum has ONE definition, beside the agent-identity helpers that
// share it — this schema publishes it rather than restating it.
const channel_agent_refs_1 = require("./channel-agent-refs");
exports.CHANNEL_INPUT_SHAPE = {
    op: zod_1.z
        .enum([
        "list",
        "open",
        "invite",
        "post",
        "read",
        "await",
        "members",
        "list_threads",
        "get_thread",
        "create_thread",
        "close_thread",
        "set_thread_mode",
        "agents",
        "summon_agent",
        "rename_agent",
        "set_agent_status",
        "join_thread",
        "leave_thread",
    ])
        .describe("Operation to perform."),
    channel: zod_1.z
        .string()
        .optional()
        .describe('Channel slug or id. Required for every op except "open" (which creates a channel) and "list" (which lists them all) — including the multiplayer ops (agents / summon_agent / rename_agent / set_agent_status / join_thread / leave_thread), since an agent and a participant set both belong to ONE channel.'),
    direct: zod_1.z
        .boolean()
        .optional()
        .describe('op="open": set true to open a direct (1:1) message instead of a named channel — pass `member` (no name). Reuses the existing DM if one already exists.'),
    name: zod_1.z
        .string()
        .optional()
        .describe('op="open" (required for a channel; omit for a direct message): the channel name (1-120 chars). op="summon_agent" (OPTIONAL): the handle for the new agent — omit it and the server picks a free one. op="rename_agent" (required): the agent\'s new handle. A handle is 2-31 characters: a lowercase letter, then lowercase letters, digits or hyphens, unique per channel — pass it BARE here, with no leading "@" (the `agent` param tolerates an @-prefix because it is looking a handle UP; this one is storing it, and the server rejects the "@").'),
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
        .describe('op="invite" (required) / op="open" with direct=true (required): the member — an email or user id of an ACTIVE workspace member. op="join_thread" / op="leave_thread": the PERSON joining or leaving the thread (pass `member` OR `agent`, never both).'),
    agent: zod_1.z
        .string()
        .optional()
        .describe('The agent, named either by its HANDLE (as in an @-mention, with or without the "@") or by its agent id. Required for op="rename_agent" / op="set_agent_status" (yours only — an agent may be changed by the member who summoned it and no one else), and for op="join_thread" / op="leave_thread" when the participant is an agent rather than a person. List the channel\'s agents with op="agents".'),
    status: zod_1.z
        .enum(channel_agent_refs_1.AGENT_STATUSES)
        .optional()
        .describe('op="set_agent_status" (required): the agent\'s lifecycle state — "summoned" (created, not yet running), "active" (working), "parked" (suspended, resumable), or "dismissed" (retired; the row and handle survive, so its old messages keep their attribution).'),
    to_agent: zod_1.z
        .string()
        .optional()
        .describe('op="post" (optional): address this message to a named AGENT — its handle or agent id, in THIS channel. Addressing an agent is what makes it ACT. Addressing a PERSON with `to` is the other path and it is NOT notify-only by default: with `as_agent` set it notifies them and starts no agent, without `as_agent` it triggers that member\'s listener and can start theirs. The agent\'s OWNER is the machine `to_agent` reaches, so setting both `to` and `to_agent` addresses the agent\'s owner, not the member in `to`.'),
    as_agent: zod_1.z
        .string()
        .optional()
        .describe('op="post" ONLY (optional; passing it to op="create_thread" is REFUSED, not dropped — the opening request is the human\'s): post AS one of YOUR OWN agents, by handle or id. It does THREE things. (1) It is REQUIRED for a post to be attributed to an agent at all; without it the message is simply its human author\'s. (2) With `to`=<a person> it makes the post a NOTIFICATION to them instead of a request that triggers their agent — that difference is `as_agent` alone. (3) It is REQUIRED to post into a BREAKOUT THREAD (`thread=<id>`) that admits you through one of YOUR AGENTS: the server checks the thread\'s participant set against the agent you CLAIM, not the ones you own, so the post is refused (403) without it. Identity is SERVER-VERIFIED: naming an agent you do not own is refused (403), never silently ignored. It supplements the human author, it never replaces one.'),
    participants: zod_1.z
        .array(zod_1.z.string())
        .max(20)
        .optional()
        .describe('op="create_thread" (optional): the EXTRA identities admitted to the thread, which turns it into a BREAKOUT ROOM — each one "agent:<handle or agent id>" or "user:<email or user id>" (the prefix is required; a bare id cannot say which kind it is). EVERY entry must ALREADY belong to this channel: a person as a MEMBER (op="members"), an agent as an agent OF THIS CHANNEL (op="agents") — a workspace colleague who is not in the channel is rejected, so invite them (op="invite") first. You and the member in `to` are added by the server, so list only the others. Once a thread has a participant set, that set is who may post into it — and an AGENT in the set must name itself with `as_agent` on every post, or the server refuses it. Agents in it still act only when ADDRESSED.'),
    // Q9 — the caps below MIRROR the routes' own zod schemas
    // (src/features/channels/schema.ts): title 200, body 16000, summary 2000
    // (the tighter 200 applies to a post's summary), client_msg_id 200. They
    // lived only in `.describe()` prose, so an over-length field was rejected
    // by the ROUTE, as an opaque 400 the write ops then mis-narrated. Declared
    // here they are published in the tool's inputSchema (the model sees a
    // maxLength) and enforced before the call is made at all.
    //
    // `.trim()` where — and only where — the route trims before measuring, so
    // the two agree on what "200 characters" counts.
    body: zod_1.z
        .string()
        .max(16000)
        .optional()
        .describe('op="post" / op="create_thread" (required): the message text, <=16000 characters. For a task_* kind, put a human-readable one-liner here and the structured payload in metadata. For create_thread, this is the requester\'s initial request.'),
    to: zod_1.z
        .string()
        .optional()
        .describe('op="post" / op="create_thread" (required for create_thread): address to one channel member — an email or user id (resolved like invite\'s member). For post, WHAT IT DOES DEPENDS ON `as_agent`: with `as_agent` the member is notified and no agent of theirs starts; without it the post is a request that triggers that member\'s listener and can start their agent. Omit it for general chat nobody must act on. For create_thread, it is the member the thread is for.'),
    // One param, two routes, two caps: a post's summary is capped at 200 and a
    // close summary at 2000. The schema declares the LOOSER of the two so a
    // legitimate close summary is never refused client-side; a 201-character
    // POST summary is still the route's to reject, and Q9's code mapping now
    // reports that honestly instead of blaming the addressee.
    summary: zod_1.z
        .string()
        .trim()
        .max(2000)
        .optional()
        .describe('op="post": a short one-line intent (<=200 chars — the post route enforces 200, not 2000). ALWAYS set it — it becomes the notification the receiving member sees. op="close_thread" (optional): a one-line outcome summary (<=2000 chars) shown on the thread card and carried in the close echo.'),
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
        .max(200)
        .optional()
        .describe('op="post" / op="create_thread": optional idempotency key — re-sending the same op with the same id won\'t create a duplicate (a repeat create_thread returns the already-created thread instead of opening a second).'),
    title: zod_1.z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe('op="create_thread" (required): the thread title (1-200 chars) — a short header for the exchange. A longer title is rejected here, before the call is made; shorten it rather than retrying.'),
    mode: zod_1.z
        .enum(["interactive", "autonomous"])
        .optional()
        .describe('op="create_thread" (optional, default "interactive") / op="set_thread_mode" (required): the thread execution mode.'),
    thread: zod_1.z
        .string()
        .optional()
        .describe('op="get_thread" / op="close_thread" / op="set_thread_mode" / op="join_thread" / op="leave_thread" (required): the thread id (returned by create_thread). op="post" (optional): thread this post under that thread — logs a milestone when combined with kind="task_progress". op="read" (optional): filter the transcript to that one exchange — only messages tagged with this thread id come back. It FILTERS, so an id no message carries returns nothing rather than an error, and `await` has no counterpart (it is always channel-wide).'),
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
        .describe(`op="await": TOTAL time to hold before returning with no messages (milliseconds, max ${channel_await_budget_1.AWAIT_HOLD_CAP_MS}; defaults to ${channel_await_budget_1.AWAIT_HOLD_DEFAULT_MS} when omitted). The hold is assembled server-side out of ~50s polls re-issued with the same cursor, so it returns the instant a message arrives. Leave it unset unless you deliberately want a short check — the long default is what keeps the call pending past the ~2-minute mark where a client that backgrounds pending calls can turn the result into a wake. If a long hold comes back as a raw transport timeout instead of a result, your own MCP client is capping the call: report that to your operator and fall back to timeout_ms=50000 plus repeated op="read".`),
};
