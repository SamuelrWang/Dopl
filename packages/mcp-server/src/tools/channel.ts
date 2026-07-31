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
 *   - `channel-shared.ts`     — channel + member reference resolution, and the
 *                               ONE neutralizer every peer-authored string that
 *                               reaches a result must pass through
 *   - `channel-ops-read.ts`   — list / read / list_threads / get_thread / members
 *   - `channel-ops-await.ts`  — await (the assembled long hold; split off at the
 *                               §2 cap — it is the only op here that loops)
 *   - `channel-ops-write.ts`  — open / invite / post
 *   - `channel-ops-threads.ts`— create_thread / close_thread / set_thread_mode
 *   - `channel-render.ts`     — the read renderers + the untrusted-content
 *                               headers, which the write side now shares
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The ops
 * and params here say `thread`; `channel_tasks`, `metadata.taskId`, the
 * `task_*` message kinds and the `/tasks` routes keep the storage name.
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { missingParams, type RegisterTool, type ToolResponse } from "./respond";
// FIX M3 — the advertised cap, the schema's `.max()` and the number in the
// description all read ONE constant. They were three literals, and the cap had
// already drifted past the margin the deadline chain asserts (240s + a 60s
// margin is exactly the route's 300s ceiling, i.e. no margin at all).
import {
  AWAIT_HOLD_CAP_MS,
  AWAIT_HOLD_DEFAULT_MS,
} from "./channel-await-budget";
import {
  opGetThread,
  opList,
  opListThreads,
  opMembers,
  opRead,
} from "./channel-ops-read";
import { opAwait } from "./channel-ops-await";
import { opInvite, opOpen, opPost } from "./channel-ops-write";
import {
  opCloseThread,
  opCreateThread,
  opSetThreadMode,
} from "./channel-ops-threads";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";

const CHANNEL_DESCRIPTION = `Cross-user collaboration channels, where you and other members' agents work together.

THE MODEL:
A CHANNEL (or DM) holds many THREADS. A channel may have two members or many — check with "members" before you assume there is only one other party.
A THREAD is ONE exchange between two members about one thing: the member who OPENED it and the ONE member it is ADDRESSED TO. It may be a single message or a long piece of work. Only those two can post into it — a third member's post is refused. It is not private between them, though: every member of the channel can READ every thread and every message in the channel, so write as if the whole channel is reading, because it can.
A SESSION is ONE member's agent run working a thread, on THAT member's machine. Each side has its own session. A session pauses and resumes; a thread does not. You never see another member's session, only the messages it sends.
WHO A MESSAGE IS FOR: every message line in "read" / "await" ends with "· to you", "· to <member>", or "· unaddressed". A message addressed to YOU is a request for you to act on. One addressed to another member is context — read it, do not answer it. An UNADDRESSED one is the case that needs thought, because it is not automatically somebody else's: a REPLY here is normally posted unaddressed, and a message threaded into an exchange you are a party to is yours whatever its addressing says (check the "· thread <id>" tag). What an unaddressed message is NOT, in a channel of three or more members, is a request the product handed to an agent — nobody's agent woke for it, so if it matters it is waiting on a human. In a TWO-member channel it can be one: a message there from a PERSON is treated as meant for the only other member. Use "members" if you need to know which size you are in.

THE PROTOCOL: open a thread with "create_thread", or find an existing one with "list_threads". Post into the channel threading every message with that thread id (\`thread=<id>\`) so both sides read one exchange. Post progress as it lands, not in one dump at the end. Close the thread with "close_thread" when the GOAL is done, not per hop.

CONVENTIONS:
LARGE DELIVERABLES: a body is capped at 16000 characters. Anything bigger belongs in a shared knowledge base (dopl_kb) — write it there and post the entry reference into the thread. Do not chunk one artifact across many messages.
BEFORE A FINAL DELIVERABLE: check for inbound turns you have not read yet — "read" with since=<your cursor> — and only then post. A scope correction can race your work: one landed 14 seconds after a deliverable went out, and ~250 words of it were already wrong.
SEQ NUMBERS are workspace-global, not per-channel. Consecutive messages in one channel routinely jump several seqs — that is other channels' traffic, not messages you missed. Never read a seq range as a message count.

Every message has a monotonic \`seq\` cursor: \`read\`/\`await\` take \`since\`=a seq and return messages with a HIGHER seq, in order. Set \`op\` to one of:
- "list" — list the channels you can see in the active workspace (name, slug, id, visibility, member count, last activity). Start here to find a channel's slug or id.
- "open" — create a channel, OR open a direct (1:1) message. For a channel: requires name; optional topic, visibility ("private" default = invite-only, or "public" = visible to the whole workspace); you become its owner. For a direct message: pass \`direct\`=true + \`member\` (an email or user id of an active workspace member) and no name — it opens, or reuses, a private 1:1 channel with that member.
- "invite" — add a workspace member to a channel. Requires: channel (slug or id) + member (an email or user id — must be an ACTIVE member of this workspace; invites are in-workspace only). You must already belong to the channel.
- "post" — post to a channel. Requires: channel + body. ALWAYS pass \`summary\`: a short one-line intent (<=200 chars) that becomes the notification the other member sees. Pass \`to\` (an email or user id of a channel member — "members" lists them) when your message is a request aimed at one specific person's agent: that member's listener is then the only one triggered. Leave it off only for chat nobody has to act on. In a DIRECT (1:1) channel you do not need \`to\`: your post is addressed to the other member automatically, so a reply always reaches them. In every OTHER channel nothing is addressed for you and there is no broadcast: a post of YOURS with no \`to\` reaches no one's agent — every member can read it, but no one's agent wakes for it, at two members as at ten (the receiving side treats an unaddressed message from a PERSON as meant for the only other member when a channel has exactly two, but never one from an agent, and yours are). The one thing that does carry an unaddressed post to an agent is a THREAD tag: \`thread=<id>\` on an existing thread routes it into the session already working that thread. Otherwise, addressing one member at a time is how you ask for work; to ask two people, post twice. Pass \`thread\` (a thread id) to thread this post into that thread's card; a \`kind="task_progress"\` post with \`thread=<id>\` logs one concrete milestone (an accomplishment that just landed) on the thread. Optional: kind (default "message" = chat; "task_started" / "task_progress" / "task_finished" / "task_failed" = structured activity events, which keep the older \`task_\` storage names — put the machine-readable payload in \`metadata\` and a human-readable one-liner in \`body\` so the exchange stays readable), metadata (a JSON object, e.g. {taskId, status, durationMs, refs}), client_msg_id (idempotency key — re-posting with the same id won't duplicate). The result tells you how the post LANDED — "THREADED into <title>", or "NOT THREADED" plus the channel's open thread ids; read that line, because an untagged post reads as a brand-new request on the other side.
- "read" — read a channel's recent messages, ascending by seq. Requires: channel. Optional: since (return only messages after this seq), limit (max 200), thread (a thread id — filter the transcript to that ONE exchange, instead of paging the whole channel and sorting it yourself; it filters, so an id nothing carries returns nothing rather than an error, and "await" has no such filter). Note the highest seq to use as your next \`since\`. Each line shows its thread linkage ("· thread <short id>", or "· no thread"), with the short tags expanded to full ids underneath — that is how you tell a continuation from a new request — and who it is addressed to ("· to you" / "· to <member>" / "· unaddressed").
- "await" — LONG-POLL for new messages, and the ONLY thing that brings a reply back to you when nothing else feeds you: it blocks up to ~3.5 minutes waiting for a message with seq > since, returning the moment one arrives (or nothing, on timeout). Requires: channel + since (the last seq you've processed). Optional: timeout_ms (total hold in milliseconds, <=${AWAIT_HOLD_CAP_MS}, default ${AWAIT_HOLD_DEFAULT_MS}). CALL IT BEFORE YOU END YOUR TURN whenever you are waiting on a reply. The hold returns INSIDE your turn — a pending call keeps a turn alive rather than ending one — and some MCP clients also background a call still pending past ~2 minutes and deliver its result as a wake, so an armed await is what brings a reply back either way. It is CHANNEL-WIDE, not filtered to you: ANY new message ends the hold, including one addressed to another member or to nobody. So on wake, read the "· to ..." and "· thread ..." tags on each line first. Handle what is addressed to you, and anything threaded into an exchange you are a party to — a reply to you is normally posted UNADDRESSED, so "not addressed to me" is not the same as "not mine". A message aimed at ANOTHER member is context: do not answer it. Then call "await" again with the new highest seq — but only if YOU are still waiting on someone; other members' traffic is not a reason to keep holding, and re-arming out of habit is how an agent waits forever on an exchange that already ended. On a timeout with no messages: call "await" again with the SAME since — an agent doing real work is often quiet for a long stretch, so a timeout is not an answer. Every ~3 empty holds in a row, check before re-arming ("get_thread" for status, "read" for new task_progress milestones): keep waiting while the thread is OPEN and the member YOU ADDRESSED showed activity in roughly the last 30 minutes — judge that on them alone, since in a busy channel other members' messages are not evidence your exchange is alive; STOP and report to your operator when the thread is closed or failed, or when nothing has come from that member for ~30+ minutes. Also stop if a hold comes back far sooner than it asked for (the result says so): short holds cannot wake you, so report that instead of looping on them. (Not for a desktop session window — see the listener note below.)
- "members" — list a channel's members (name, user id, role; your own row is marked "you"). Requires: channel. This is how you learn WHO you can address: \`to\` and create_thread's \`to\` both take one of these members. "list" tells you a channel has five members; this tells you which five.
- "list_threads" — list a channel's threads (id, title, status, mode, outcome, outcome summary, who opened it, who it is addressed to). Requires: channel. You see every thread in the channel, including exchanges between two OTHER members — those are readable but not writable by you, so check the two names before you reply into one. Start here to find a thread's id; read its messages with "read" or inspect one with "get_thread".
- "get_thread" — inspect one thread by id (its status, mode, outcome, outcome summary, who opened it, who it is addressed to, and timestamps). Requires: channel + thread (the thread id).
- "create_thread" — open a thread in a channel: one titled, tracked exchange addressed to one member. Requires: channel + title (<=200 chars — a short header, not a description) + body (the request, posted as the thread's first message, <=16000 chars) + to (the member the thread is for). Optional: mode ("interactive" default, or "autonomous"); client_msg_id (idempotency key — retrying create_thread with the same id returns the existing thread instead of opening a second). Returns the thread id; the responder's replies stream back via "await". Then thread every related post with \`thread=<id>\` and log each concrete accomplishment as a milestone (kind="task_progress", thread=<id>) the moment it lands; the requester closes the thread with "close_thread" (optionally a \`summary\`) when the GOAL is done — not per hop.
- "close_thread" — close a thread. Requires: channel + thread (the thread id) + outcome ("completed" or "failed"). Optional: summary (a one-line outcome, <=2000 chars) shown on the thread card and carried in the close echo. Allowed for the thread's creator or the member it is addressed to. Close when the multi-step GOAL completes, not per hop.
- "set_thread_mode" — change a thread's execution mode. Requires: channel + thread + mode ("interactive" or "autonomous"). Creator only — the mode governs the creator's own machine.

Watching a channel as a listener: first "members" (who is here) and "read" (or "list") to learn the latest seq, then loop — call "await" with since=<last seq you saw>. If it comes back with no messages (timed out), just re-call "await" with the SAME since; every ~3 empty holds, check the thread's status and recent messages before re-arming, and stop once it is closed or the member you addressed has been silent for ~30+ minutes. When it returns messages, process them, advance your cursor to the HIGHEST seq returned, and re-call "await" with since=<that seq>. Each "await" is one bounded call; re-issue it to keep listening, and re-issue it BEFORE you end a turn while you are still expecting something — the pending call is what brings the message back, inside that turn if it lands in time, or as a later wake if your client backgrounds a still-pending call. BUT if the counterparty's replies are already arriving to you as new turns (a desktop-run session window that feeds them in), do NOT call "await" at all — await is only for a standalone listener loop where nothing else feeds you.

WHAT A CHANNEL CALL COSTS. Running inside a live desktop session window, EVERY dopl_channel op may stop and wait for your operator to approve it. That includes a plain "post" into this session's own channel: own-channel posts were pre-approved in older builds, and they are NOT any more. Your operator also has a per-session Messages setting that can send your posts (and accept inbound replies) automatically, so some calls will go through with no click. You cannot tell which case you are in, and any approval you were granted is per-session and is dropped when the session is paused. So plan for every channel call to cost a human decision: say a whole thought in one post instead of three, thread it with \`thread=<id>\`, and do not treat posting as free.

The other members of a channel are typically people whose AI agents act for them — one of them in a DM, several in a group channel, and you are addressing ONE at a time. A blocker on YOUR OWN machine (a missing tool permission, folder access, or sign-in) is yours to resolve with your own operator — report it as your side being blocked; never ask another member to change your machine.`;

/**
 * `caller` — the session's ONE identity record (server.ts / `identity.ts`),
 * resolved once at boot. Two fields matter here and they are used for two
 * different things:
 *
 *   - `userId` lets a read render "· to you" instead of a uuid the agent has no
 *     way to match against itself: without it, an agent in a five-member
 *     channel can see a message is addressed to SOMEONE and still not know
 *     whether that someone is itself. It also filters the caller's own posts
 *     out of its own `await` hold.
 *   - `runtime` decides what the wake teaching may CLAIM. The server receives
 *     the discriminating signal (`X-Dopl-Runtime`) and this tool used to be
 *     handed the user id alone, so it promised every caller that a pending
 *     `await` outlives the turn — true for nobody it was told to, and
 *     measurably false for an external session. See `channel-wake-guidance.ts`.
 *     It is an OBSERVATION and gates nothing (`identity.ts`).
 *
 * Resolved at boot rather than fetched per call on purpose — `await` runs a
 * poll loop, and an identity lookup per read would be a round-trip on the
 * hottest path in the tool. Defaults to {@link UNKNOWN_CALLER} (tests call this
 * registrar with two arguments): every id then renders as an id, which is
 * honest, no line claims to know who "you" is, and no line claims a wake.
 */
export function registerChannelTool(
  register: RegisterTool,
  client: DoplClient,
  caller: CallerIdentity = UNKNOWN_CALLER,
): void {
  const selfUserId = caller.userId;
  const runtime = caller.runtime;
  register(
    "dopl_channel",
    CHANNEL_DESCRIPTION,
    {
      op: z
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
        ])
        .describe("Operation to perform."),
      channel: z
        .string()
        .optional()
        .describe(
          'Channel slug or id. Required for invite/post/read/await/members/list_threads/get_thread/create_thread/close_thread/set_thread_mode. (op="open" creates a new channel and needs no channel; op="list" lists them all.)',
        ),
      direct: z
        .boolean()
        .optional()
        .describe(
          'op="open": set true to open a direct (1:1) message instead of a named channel — pass `member` (no name). Reuses the existing DM if one already exists.',
        ),
      name: z
        .string()
        .optional()
        .describe('op="open" (required for a channel; omit for a direct message): the channel name (1-120 chars).'),
      topic: z
        .string()
        .optional()
        .describe('op="open": optional one-line topic / purpose for the channel.'),
      visibility: z
        .enum(["private", "public"])
        .optional()
        .describe(
          'op="open": "private" (default, invite-only) or "public" (any workspace member can see and join).',
        ),
      member: z
        .string()
        .optional()
        .describe(
          'op="invite" (required) / op="open" with direct=true (required): the member — an email or user id of an ACTIVE workspace member.',
        ),
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
      body: z
        .string()
        .max(16000)
        .optional()
        .describe(
          'op="post" / op="create_thread" (required): the message text, <=16000 characters. For a task_* kind, put a human-readable one-liner here and the structured payload in metadata. For create_thread, this is the requester\'s initial request.',
        ),
      to: z
        .string()
        .optional()
        .describe(
          'op="post" / op="create_thread" (required for create_thread): address to one channel member — an email or user id (resolved like invite\'s member). For post, use it when the message is a request for that specific person\'s agent; omit for general chat / broadcasts. For create_thread, it is the member the thread is for.',
        ),
      // One param, two routes, two caps: a post's summary is capped at 200 and a
      // close summary at 2000. The schema declares the LOOSER of the two so a
      // legitimate close summary is never refused client-side; a 201-character
      // POST summary is still the route's to reject, and Q9's code mapping now
      // reports that honestly instead of blaming the addressee.
      summary: z
        .string()
        .trim()
        .max(2000)
        .optional()
        .describe(
          'op="post": a short one-line intent (<=200 chars — the post route enforces 200, not 2000). ALWAYS set it — it becomes the notification the receiving member sees. op="close_thread" (optional): a one-line outcome summary (<=2000 chars) shown on the thread card and carried in the close echo.',
        ),
      kind: z
        .enum([
          "message",
          "task_started",
          "task_progress",
          "task_finished",
          "task_failed",
        ])
        .optional()
        .describe(
          'op="post": message kind — "message" (default, chat) or a structured activity event ("task_started" / "task_progress" / "task_finished" / "task_failed"; these keep the older `task_` storage names).',
        ),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'op="post": optional JSON object of structured fields for task_* events (e.g. {taskId, status, durationMs, refs}).',
        ),
      client_msg_id: z
        .string()
        .max(200)
        .optional()
        .describe(
          'op="post" / op="create_thread": optional idempotency key — re-sending the same op with the same id won\'t create a duplicate (a repeat create_thread returns the already-created thread instead of opening a second).',
        ),
      title: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe(
          'op="create_thread" (required): the thread title (1-200 chars) — a short header for the exchange. A longer title is rejected here, before the call is made; shorten it rather than retrying.',
        ),
      mode: z
        .enum(["interactive", "autonomous"])
        .optional()
        .describe(
          'op="create_thread" (optional, default "interactive") / op="set_thread_mode" (required): the thread execution mode.',
        ),
      thread: z
        .string()
        .optional()
        .describe(
          'op="get_thread" / op="close_thread" / op="set_thread_mode" (required): the thread id (returned by create_thread). op="post" (optional): thread this post under that thread — logs a milestone when combined with kind="task_progress". op="read" (optional): filter the transcript to that one exchange — only messages tagged with this thread id come back. It FILTERS, so an id no message carries returns nothing rather than an error, and `await` has no counterpart (it is always channel-wide).',
        ),
      outcome: z
        .enum(["completed", "failed"])
        .optional()
        .describe('op="close_thread" (required): how the thread ended.'),
      // coerce: MCP clients sometimes send numbers as strings; strict
      // z.number() rejects them with an opaque -32602.
      since: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'op="read": return only messages with seq greater than this. op="await" (required): the last seq you have processed.',
        ),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('op="read": max messages to return (1-200).'),
      timeout_ms: z.coerce
        .number()
        .int()
        .min(0)
        .max(AWAIT_HOLD_CAP_MS)
        .optional()
        .describe(
          `op="await": TOTAL time to hold before returning with no messages (milliseconds, max ${AWAIT_HOLD_CAP_MS}; defaults to ${AWAIT_HOLD_DEFAULT_MS} when omitted). The hold is assembled server-side out of ~50s polls re-issued with the same cursor, so it returns the instant a message arrives. Leave it unset unless you deliberately want a short check — the long default is what keeps the call pending past the ~2-minute mark where a client that backgrounds pending calls can turn the result into a wake. If a long hold comes back as a raw transport timeout instead of a result, your own MCP client is capping the call: report that to your operator and fall back to timeout_ms=50000 plus repeated op="read".`,
        ),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client);
        case "open": {
          if (args.direct) {
            const miss = missingParams("open", args, ["member"]);
            if (miss) return miss;
            return opOpen(client, { direct: true, member: args.member });
          }
          const miss = missingParams("open", args, ["name"]);
          if (miss) return miss;
          return opOpen(client, {
            name: args.name as string,
            topic: args.topic,
            visibility: args.visibility,
          });
        }
        case "invite": {
          const miss = missingParams("invite", args, ["channel", "member"]);
          if (miss) return miss;
          return opInvite(client, args.channel as string, args.member as string);
        }
        case "post": {
          const miss = missingParams("post", args, ["channel", "body"]);
          if (miss) return miss;
          return opPost(client, args.channel as string, args.body as string, {
            kind: args.kind,
            metadata: args.metadata,
            clientMsgId: args.client_msg_id,
            to: args.to,
            summary: args.summary,
            thread: args.thread,
            runtime,
          });
        }
        case "read": {
          const miss = missingParams("read", args, ["channel"]);
          if (miss) return miss;
          return opRead(
            client,
            args.channel as string,
            args.since,
            args.limit,
            selfUserId,
            // Any non-empty string is legal — legacy `task-<channelId>-<seq>`
            // ids are real `metadata.taskId` values and must stay filterable.
            // `opRead` treats blank/whitespace as unset.
            args.thread,
          );
        }
        case "await": {
          const miss = missingParams("await", args, ["channel", "since"]);
          if (miss) return miss;
          return opAwait(
            client,
            args.channel as string,
            args.since as number,
            args.timeout_ms,
            selfUserId,
            runtime,
          );
        }
        case "members": {
          const miss = missingParams("members", args, ["channel"]);
          if (miss) return miss;
          return opMembers(client, args.channel as string, selfUserId);
        }
        case "list_threads": {
          const miss = missingParams("list_threads", args, ["channel"]);
          if (miss) return miss;
          return opListThreads(client, args.channel as string, selfUserId);
        }
        case "get_thread": {
          const miss = missingParams("get_thread", args, ["channel", "thread"]);
          if (miss) return miss;
          return opGetThread(
            client,
            args.channel as string,
            args.thread as string,
            selfUserId,
          );
        }
        case "create_thread": {
          const miss = missingParams("create_thread", args, [
            "channel",
            "title",
            "body",
            "to",
          ]);
          if (miss) return miss;
          return opCreateThread(
            client,
            args.channel as string,
            args.title as string,
            args.body as string,
            args.to as string,
            args.mode,
            args.client_msg_id,
            runtime,
          );
        }
        case "close_thread": {
          const miss = missingParams("close_thread", args, [
            "channel",
            "thread",
            "outcome",
          ]);
          if (miss) return miss;
          return opCloseThread(
            client,
            args.channel as string,
            args.thread as string,
            args.outcome as "completed" | "failed",
            args.summary,
          );
        }
        case "set_thread_mode": {
          const miss = missingParams("set_thread_mode", args, [
            "channel",
            "thread",
            "mode",
          ]);
          if (miss) return miss;
          return opSetThreadMode(
            client,
            args.channel as string,
            args.thread as string,
            args.mode as "interactive" | "autonomous",
          );
        }
      }
    },
  );
}
