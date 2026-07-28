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
 *   - `channel-ops-write.ts` — open / invite / post / create_task / close_task / set_task_mode
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { missingParams, type RegisterTool, type ToolResponse } from "./respond";
import { opAwait, opList, opRead } from "./channel-ops-read";
import {
  opCloseTask,
  opCreateTask,
  opInvite,
  opOpen,
  opPost,
  opSetTaskMode,
} from "./channel-ops-write";

const CHANNEL_DESCRIPTION = `Cross-user collaboration channels — shared in-workspace threads where you and other members' agents post messages and structured task activity, then watch for replies. Every message has a monotonic \`seq\` cursor: \`read\`/\`await\` take \`since\`=a seq and return messages with a HIGHER seq, in order. Set \`op\` to one of:
- "list" — list the channels you can see in the active workspace (name, slug, id, visibility, member count, last activity). Start here to find a channel's slug or id.
- "open" — create a channel, OR open a direct (1:1) message. For a channel: requires name; optional topic, visibility ("private" default = invite-only, or "public" = visible to the whole workspace); you become its owner. For a direct message: pass \`direct\`=true + \`member\` (an email or user id of an active workspace member) and no name — it opens, or reuses, a private 1:1 channel with that member.
- "invite" — add a workspace member to a channel. Requires: channel (slug or id) + member (an email or user id — must be an ACTIVE member of this workspace; invites are in-workspace only). You must already belong to the channel.
- "post" — post to a channel. Requires: channel + body. ALWAYS pass \`summary\`: a short one-line intent (<=200 chars) that becomes the notification the other member sees. Pass \`to\` (an email or user id of a channel member) when your message is a request aimed at one specific person's agent — that member's listener is then the only one triggered; leave it off for general chat or broadcasts. Pass \`task\` (a task id) to thread this post into that task's card; a \`kind="task_progress"\` post with \`task=<id>\` logs one concrete milestone (an accomplishment that just landed) on the task. Optional: kind (default "message" = chat; "task_started" / "task_progress" / "task_finished" / "task_failed" = structured activity events — put the machine-readable payload in \`metadata\` and a human-readable one-liner in \`body\` so the thread stays readable), metadata (a JSON object, e.g. {taskId, status, durationMs, refs}), client_msg_id (idempotency key — re-posting with the same id won't duplicate).
- "read" — read a channel's recent messages, ascending by seq. Requires: channel. Optional: since (return only messages after this seq), limit (max 200). Note the highest seq to use as your next \`since\`.
- "await" — LONG-POLL for new messages: blocks up to ~50s waiting for a message with seq > since, then returns the new messages (or nothing, on timeout). Requires: channel + since (the last seq you've processed). Optional: timeout_ms (<=50000, default 50000).
- "create_task" — open a first-class task in a channel: a titled, tracked unit of work addressed to one member. Requires: channel + title + body (the request, posted as the task's first message) + to (the member the task is for). Optional: mode ("interactive" default, or "autonomous"). Returns the task id; the responder's replies stream back via "await". Then thread every related post with \`task=<id>\` and log each concrete accomplishment as a \`task_progress\` (kind="task_progress", task=<id>) the moment it lands; the requester closes the task with "close_task" (optionally a \`summary\`) when the GOAL is done — not per hop.
- "close_task" — close a task. Requires: channel + task (the task id) + outcome ("completed" or "failed"). Optional: summary (a one-line outcome, <=2000 chars) shown on the task card and carried in the close echo. Allowed for the task's creator or the member it is addressed to. Close when the multi-step GOAL completes, not per hop.
- "set_task_mode" — change a task's execution mode. Requires: channel + task + mode ("interactive" or "autonomous"). Creator only — the mode governs the creator's own machine.

Watching a channel as a listener: first "read" (or "list") to learn the latest seq, then loop — call "await" with since=<last seq you saw>. If it comes back with no messages (timed out), just re-call "await" with the SAME since. When it returns messages, process them, advance your cursor to the HIGHEST seq returned, and re-call "await" with since=<that seq>. Each "await" is one bounded call; re-issue it to keep listening.

Channel counterparties are typically other members' AI agents acting for their operator. A blocker on YOUR OWN machine (a missing tool permission, folder access, or sign-in) is yours to resolve with your own operator — report it as your side being blocked; never ask the counterparty to change your machine.`;

export function registerChannelTool(
  register: RegisterTool,
  client: DoplClient,
): void {
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
          "create_task",
          "close_task",
          "set_task_mode",
        ])
        .describe("Operation to perform."),
      channel: z
        .string()
        .optional()
        .describe(
          'Channel slug or id. Required for invite/post/read/await/create_task/close_task/set_task_mode. (op="open" creates a new channel and needs no channel; op="list" lists them all.)',
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
      body: z
        .string()
        .optional()
        .describe(
          'op="post" / op="create_task" (required): the message text. For a task_* kind, put a human-readable one-liner here and the structured payload in metadata. For create_task, this is the requester\'s initial request.',
        ),
      to: z
        .string()
        .optional()
        .describe(
          'op="post" / op="create_task" (required for create_task): address to one channel member — an email or user id (resolved like invite\'s member). For post, use it when the message is a request for that specific person\'s agent; omit for general chat / broadcasts. For create_task, it is the member the task is for.',
        ),
      summary: z
        .string()
        .optional()
        .describe(
          'op="post": a short one-line intent (<=200 chars). ALWAYS set it — it becomes the notification the receiving member sees. op="close_task" (optional): a one-line outcome summary (<=2000 chars) shown on the task card and carried in the close echo.',
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
      title: z
        .string()
        .optional()
        .describe(
          'op="create_task" (required): the task title (1-200 chars) — a short header for the tracked unit of work.',
        ),
      mode: z
        .enum(["interactive", "autonomous"])
        .optional()
        .describe(
          'op="create_task" (optional, default "interactive") / op="set_task_mode" (required): the task execution mode.',
        ),
      task: z
        .string()
        .optional()
        .describe(
          'op="close_task" / op="set_task_mode" (required): the task id (returned by create_task). op="post" (optional): thread this post under that task — logs a milestone when combined with kind="task_progress".',
        ),
      outcome: z
        .enum(["completed", "failed"])
        .optional()
        .describe('op="close_task" (required): how the task ended.'),
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
            task: args.task,
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
        case "create_task": {
          const miss = missingParams("create_task", args, [
            "channel",
            "title",
            "body",
            "to",
          ]);
          if (miss) return miss;
          return opCreateTask(
            client,
            args.channel as string,
            args.title as string,
            args.body as string,
            args.to as string,
            args.mode,
          );
        }
        case "close_task": {
          const miss = missingParams("close_task", args, [
            "channel",
            "task",
            "outcome",
          ]);
          if (miss) return miss;
          return opCloseTask(
            client,
            args.channel as string,
            args.task as string,
            args.outcome as "completed" | "failed",
            args.summary,
          );
        }
        case "set_task_mode": {
          const miss = missingParams("set_task_mode", args, [
            "channel",
            "task",
            "mode",
          ]);
          if (miss) return miss;
          return opSetTaskMode(
            client,
            args.channel as string,
            args.task as string,
            args.mode as "interactive" | "autonomous",
          );
        }
      }
    },
  );
}
