/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A channel is a shared in-workspace thread. Agents (and users) post
 * messages and structured task-activity events, then long-poll for
 * replies. Every message has a monotonic `seq` cursor, so a listener can
 * ask for "everything after seq N" (op="read"/"await").
 *
 * This file is the thin registrar: it owns the single tool schema + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `channel-shared.ts`    — channel + member reference resolution
 *   - `channel-ops-read.ts`  — list / read / await
 *   - `channel-ops-write.ts` — open / invite / post
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { missingParams, type RegisterTool, type ToolResponse } from "./respond";
import { opAwait, opList, opRead } from "./channel-ops-read";
import { opInvite, opOpen, opPost } from "./channel-ops-write";

const CHANNEL_DESCRIPTION = `Cross-user collaboration channels — shared in-workspace threads where you and other members' agents post messages and structured task activity, then watch for replies. Every message has a monotonic \`seq\` cursor: \`read\`/\`await\` take \`since\`=a seq and return messages with a HIGHER seq, in order. Set \`op\` to one of:
- "list" — list the channels you can see in the active workspace (name, slug, id, visibility, member count, last activity). Start here to find a channel's slug or id.
- "open" — create a channel. Requires: name. Optional: topic, visibility ("private" default = invite-only, or "public" = visible to the whole workspace). You become its owner.
- "invite" — add a workspace member to a channel. Requires: channel (slug or id) + member (an email or user id — must be an ACTIVE member of this workspace; invites are in-workspace only). You must already belong to the channel.
- "post" — post to a channel. Requires: channel + body. ALWAYS pass \`summary\`: a short one-line intent (<=200 chars) that becomes the notification the other member sees. Pass \`to\` (an email or user id of a channel member) when your message is a request aimed at one specific person's agent — that member's listener is then the only one triggered; leave it off for general chat or broadcasts. Optional: kind (default "message" = chat; "task_started" / "task_progress" / "task_finished" / "task_failed" = structured activity events — put the machine-readable payload in \`metadata\` and a human-readable one-liner in \`body\` so the thread stays readable), metadata (a JSON object, e.g. {taskId, status, durationMs, refs}), client_msg_id (idempotency key — re-posting with the same id won't duplicate).
- "read" — read a channel's recent messages, ascending by seq. Requires: channel. Optional: since (return only messages after this seq), limit (max 200). Note the highest seq to use as your next \`since\`.
- "await" — LONG-POLL for new messages: blocks up to ~50s waiting for a message with seq > since, then returns the new messages (or nothing, on timeout). Requires: channel + since (the last seq you've processed). Optional: timeout_ms (<=50000, default 50000).

Watching a channel as a listener: first "read" (or "list") to learn the latest seq, then loop — call "await" with since=<last seq you saw>. If it comes back with no messages (timed out), just re-call "await" with the SAME since. When it returns messages, process them, advance your cursor to the HIGHEST seq returned, and re-call "await" with since=<that seq>. Each "await" is one bounded call; re-issue it to keep listening.`;

export function registerChannelTool(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_channel",
    CHANNEL_DESCRIPTION,
    {
      op: z
        .enum(["list", "open", "invite", "post", "read", "await"])
        .describe("Operation to perform."),
      channel: z
        .string()
        .optional()
        .describe(
          'Channel slug or id. Required for invite/post/read/await. (op="open" creates a new channel and needs no channel; op="list" lists them all.)',
        ),
      name: z
        .string()
        .optional()
        .describe('op="open" (required): the channel name (1-120 chars).'),
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
          'op="invite" (required): the member to add — an email or user id of an ACTIVE workspace member.',
        ),
      body: z
        .string()
        .optional()
        .describe(
          'op="post" (required): the message text. For a task_* kind, put a human-readable one-liner here and the structured payload in metadata.',
        ),
      to: z
        .string()
        .optional()
        .describe(
          'op="post": address this message to one channel member — an email or user id (resolved like invite\'s member). Use it when the post is a request for that specific person\'s agent; their listener is the only one triggered. Omit for general chat / broadcasts.',
        ),
      summary: z
        .string()
        .optional()
        .describe(
          'op="post": a short one-line intent (<=200 chars). ALWAYS set it — it becomes the notification the receiving member sees.',
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
          'op="post": message kind — "message" (default, chat) or a structured activity event ("task_started" / "task_progress" / "task_finished" / "task_failed").',
        ),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'op="post": optional JSON object of structured fields for task_* events (e.g. {taskId, status, durationMs, refs}).',
        ),
      client_msg_id: z
        .string()
        .optional()
        .describe(
          'op="post": optional idempotency key — re-posting with the same id won\'t create a duplicate.',
        ),
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
        .max(50_000)
        .optional()
        .describe(
          'op="await": how long to long-poll before returning with no messages (milliseconds, max 50000; defaults to 50000 when omitted).',
        ),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client);
        case "open": {
          const miss = missingParams("open", args, ["name"]);
          if (miss) return miss;
          return opOpen(client, args.name as string, args.topic, args.visibility);
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
          });
        }
        case "read": {
          const miss = missingParams("read", args, ["channel"]);
          if (miss) return miss;
          return opRead(client, args.channel as string, args.since, args.limit);
        }
        case "await": {
          const miss = missingParams("await", args, ["channel", "since"]);
          if (miss) return miss;
          return opAwait(
            client,
            args.channel as string,
            args.since as number,
            args.timeout_ms,
          );
        }
      }
    },
  );
}
