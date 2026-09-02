/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one shared exchange
 * between two members; a SESSION is one member's agent run working it. Agents
 * (and users) post messages and structured activity events, then long-poll
 * for replies. Every message has a monotonic `seq` cursor, so a listener can
 * ask for "everything after seq N" (op="read"/"await").
 *
 * Thin registrar: owns the single tool schema + op routing, delegating to
 *   - `channel-shared.ts`     — ref resolution + the ONE neutralizer every
 *                               peer-authored string must pass through
 *   - `channel-ops-read.ts`   — list / read / list_threads / get_thread /
 *                               members / read_sessions
 *   - `channel-ops-await.ts`  — await (the only looping op)
 *   - `channel-ops-open.ts`   — open / invite
 *   - `channel-ops-write.ts`  — post (+ `channel-post-notes.ts` /
 *                               `channel-post-linkage.ts` for its result lines)
 *   - `channel-ops-threads.ts`— create_thread / set_thread_mode
 *   - `channel-render.ts`     — read renderers + untrusted-content headers,
 *                               shared with the write side
 *
 * ⚠ A channel reaches PEOPLE. There is no agent-handle addressing; the only
 * distinction a post makes is `intent` chat vs. request.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Ops and params
 * say `thread`; `channel_tasks`, `metadata.taskId`, `task_*` kinds and the
 * `/tasks` routes keep the storage name.
 *
 * ⚠ No `dopl_channel_admin` twin — no destructive ops over MCP (archive/delete
 * are human decisions in the web UI).
 */

import type { DoplClient } from "@dopl/client";
import { err, missingParams, type RegisterTool, type ToolResponse } from "./respond";
// The tool's two declared halves: PROSE (what a channel is, THE LAW, what each
// op does) and published input SHAPE. This file is mechanism only.
import { CHANNEL_DESCRIPTION } from "./channel-description";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  opGetThread,
  opList,
  opListThreads,
  opMembers,
  opRead,
  opReadSessions,
} from "./channel-ops-read";
import { opAwait } from "./channel-ops-await";
// ⚠ WORKSPACE-WIDE await is a SIBLING op, not a branch inside `opAwait`: the
// per-channel result vocabulary splices `ref` into every sentence, and threading
// an absent ref through it would produce guidance with a hole in it.
import { opAwaitWorkspace } from "./channel-ops-await-workspace";
import { opInvite, opOpen } from "./channel-ops-open";
import { opPost } from "./channel-ops-write";
import { opCreateThread, opSetThreadMode } from "./channel-ops-threads";
import { opLaunchAgent } from "./channel-ops-launch";
// AGENT MANAGEMENT (2026-09-01) — the launch mailbox's OTHER two kinds. A stop
// verb and a display verb over the same lane, own-operator only.
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { opUpdate } from "./channel-ops-update";
// ⚠ A structured POST, not a second delivery path — it delegates to `opPost`.
import { opEscalate } from "./channel-ops-escalate";
// THE PRIVATE DIRECT LANE (2026-08-31) — a mailbox the operator's OWN machine
// claims, never a message and never another member's machine.
import { opDirectAgent, opReadDirections } from "./channel-ops-direct";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";

/**
 * `caller` — the session's ONE identity record (`identity.ts`), resolved once
 * at boot:
 *   - `userId` renders "· to you" instead of a uuid the agent cannot match
 *     against itself, and filters the caller's own posts out of its `await`.
 *   - `runtime` decides what the wake teaching may CLAIM (from
 *     `X-Dopl-Runtime`). ⚠ An OBSERVATION that gates nothing — without it the
 *     tool promises every caller that a pending `await` outlives the turn,
 *     which is measurably false for an external session.
 *
 * ⚠ Resolved at boot, never per call: `await` runs a poll loop, so an identity
 * lookup per read is a round-trip on the hottest path. Defaults to
 * {@link UNKNOWN_CALLER} — ids render as ids, no line claims to know "you", no
 * line claims a wake.
 *
 * `isAdmin` — workspace-admin flag from the boot status ping. ⚠ Used ONLY by
 * `op="members"` to gate member EMAIL, and defaults false (fail-closed): a test
 * registrar or a failed ping never leaks email.
 */
export function registerChannelTool(
  register: RegisterTool,
  client: DoplClient,
  caller: CallerIdentity = UNKNOWN_CALLER,
  isAdmin = false,
): void {
  const selfUserId = caller.userId;
  const runtime = caller.runtime;
  register(
    "dopl_channel",
    CHANNEL_DESCRIPTION,
    CHANNEL_INPUT_SHAPE,
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
            intent: args.intent,
            runtime,
          });
        }
        // ⚠ The `kind` is fixed HERE, at the routing seam, so the agent never
        // picks between enum values one apart. `thread` is REQUIRED where
        // `post` leaves it optional — an untagged milestone groups into
        // nothing, the one shape of this call that is always a mistake.
        // Delegates to `opPost` rather than growing a second delivery path.
        // ⚠ `to` is NOT routed through: a milestone marks the thread and
        // addresses nobody.
        case "milestone": {
          const miss = missingParams("milestone", args, [
            "channel",
            "body",
            "thread",
          ]);
          if (miss) return miss;
          return opPost(client, args.channel as string, args.body as string, {
            kind: "task_progress",
            thread: args.thread as string,
            summary: args.summary,
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
            // ⚠ Any non-empty string is legal — legacy `task-<channelId>-<seq>`
            // ids are real `metadata.taskId` values and must stay filterable.
            args.thread,
          );
        }
        // ⚠ `channel` IS OPTIONAL HERE AND ONLY HERE AMONG THE HOLDS. Omitting
        // it holds across EVERY channel the caller is a MEMBER of — a different
        // service, a different fence (a re-proved membership set rather than one
        // resolved channel id) and a different re-arm stop rule, which is why it
        // is a different handler rather than a flag. `since` stays required on
        // BOTH: `seq` is workspace-global, so one cursor is legal across every
        // channel, but a hold with no cursor is a firehose either way.
        case "await": {
          const miss = missingParams("await", args, ["since"]);
          if (miss) return miss;
          if (args.channel === undefined || args.channel.trim() === "") {
            return opAwaitWorkspace(
              client,
              args.since as number,
              args.timeout_ms,
              selfUserId,
            );
          }
          return opAwait(
            client,
            args.channel,
            args.since as number,
            args.timeout_ms,
            selfUserId,
            runtime,
          );
        }
        case "members": {
          const miss = missingParams("members", args, ["channel"]);
          if (miss) return miss;
          // ⚠ Admin flag gates member EMAIL in the roster render.
          return opMembers(client, args.channel as string, selfUserId, isAdmin);
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
        // ⚠ `channel` is an OPTIONAL filter here, hence no missingParams check.
        // Own-scoped in the service; the transport credential IS the caller, so
        // no identity is passed.
        case "read_sessions":
          return opReadSessions(client, args.channel);
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
            // SPAWN-WITH-HANDOFF — declares the driving session opens on the
            // operator's own machine.
            args.handoff,
          );
        }
        // ⚠ TWO CASES ENDED HERE with thread closing (wiring plan Phase 4,
        // 2026-08-18): "propose_close" (the agent's terminal act, confirmed by
        // its operator) and "close_thread" (answered with a teaching refusal
        // rather than dropped from the enum, so an older agent got a sentence
        // instead of a zod error). Both left the enum in `channel-schema.ts`,
        // so a stale caller now gets an invalid-enum -32602 — the accepted cost
        // of the words not surviving anywhere in the shipped surface.
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
        // ⚠ DIRECT ONE OF THE OPERATOR'S OWN RUNNING AGENTS, PRIVATELY. The op
        // NEVER names an operator — the server stamps the authenticated caller,
        // because the only machine an agent may direct is its own operator's and
        // there is no argument here that could say otherwise. `agent` is REQUIRED
        // and has no fallback: this lane reaches a PRIVATE TURN, and resolving to
        // "the oldest agent on the thread" would steer one the caller did not
        // address with nothing reporting the swap.
        case "direct_agent": {
          const miss = missingParams("direct_agent", args, [
            "channel",
            "agent_id",
            "body",
          ]);
          if (miss) return miss;
          return opDirectAgent(
            client,
            args.channel as string,
            args.agent_id as string,
            args.body as string,
            { thread: args.thread, waitMs: args.wait_ms },
          );
        }
        // ⚠ BOTH FILTERS ARE OPTIONAL, hence no missingParams check. Own-scoped in
        // the service; the transport credential IS the caller, so no identity is
        // passed and none could be.
        case "read_directions":
          return opReadDirections(client, {
            channel: args.channel,
            agent: args.agent_id,
          });
        // ⚠ ASKS THE OPERATOR'S OWN MACHINE TO START AN AGENT. `goal`, `model`,
        // `thread` and `wait_ms` are all optional; only `channel` is required.
        // The op NEVER names an operator — the server stamps the authenticated
        // caller, because the only machine an agent may ask is its own
        // operator's, and there is no argument here that could say otherwise.
        case "launch_agent": {
          const miss = missingParams("launch_agent", args, ["channel"]);
          if (miss) return miss;
          return opLaunchAgent(client, args.channel as string, {
            thread: args.thread,
            goal: args.goal,
            model: args.model,
            // ⚠ PASSED THROUGH AS A STRING, NEVER PARSED HERE. Whether it is an
            // id or a name — and whether a name is ambiguous — is decided
            // SERVER-SIDE, against the caller's own template visibility, which
            // this process cannot evaluate.
            template: args.template,
            waitMs: args.wait_ms,
          });
        }
        // ⚠ END ONE OF THE OPERATOR'S OWN RUNNING AGENTS. The SAME mailbox
        // `launch_agent` writes, with `kind: "end"` — so the machine decides, a
        // refusal is normal and a timeout is PENDING rather than failed. The op
        // NEVER names an operator: the server stamps the authenticated caller,
        // and a target belonging to another member is refused before any row
        // exists. ⚠ `channel` IS REQUIRED even though `agent_id` addresses the
        // target on its own — the create proves a MEMBERSHIP ROW there, which is
        // what stops this being a bare "end agent <id>" primitive.
        case "end_agent": {
          const miss = missingParams("end_agent", args, [
            "channel",
            "agent_id",
          ]);
          if (miss) return miss;
          return opEndAgent(client, args.channel as string, args.agent_id as string, {
            waitMs: args.wait_ms,
          });
        }
        // ⚠ RELABEL ONE OF THE OPERATOR'S OWN AGENTS — DISPLAY ONLY, on that one
        // machine. `name` is REQUIRED and the EMPTY STRING is a legal value that
        // CLEARS the name, which is why it is checked for presence rather than
        // for truthiness: `missingParams` would reject "" as absent and delete
        // the one gesture that undoes a rename.
        case "rename_agent": {
          const miss = missingParams("rename_agent", args, [
            "channel",
            "agent_id",
          ]);
          if (miss) return miss;
          // ⚠ NOT `missingParams`, AND THAT IS THE WHOLE REASON THIS BRANCH IS
          // HAND-WRITTEN. That helper counts the EMPTY STRING as absent, which is
          // right for every other param on this tool and wrong for exactly this
          // one: `name: ""` is the legal, deliberate gesture that CLEARS a
          // display name. Routing it through the helper would delete the only way
          // to undo a rename and report it as a missing argument.
          if (typeof args.name !== "string") {
            return err(
              'op="rename_agent" is missing required param: name. Pass the display name you want (1-60 visible characters on one line), or the EMPTY STRING to clear the name back to "Agent #<id>".',
            );
          }
          return opRenameAgent(
            client,
            args.channel as string,
            args.agent_id as string,
            args.name,
            { waitMs: args.wait_ms },
          );
        }
        // ⚠ THE INFO CARD ONLY. `name` / `topic` / `archived` are accepted by
        // the same route and are deliberately NOT routed here (Samuel's ruling
        // Q12 (b); F-346 holds the rename hole open). ⚠ `info_card` OMITTED is
        // the READ — the card is replaced whole, so a blind write clobbers.
        case "update": {
          const miss = missingParams("update", args, ["channel"]);
          if (miss) return miss;
          return opUpdate(client, args.channel as string, args.info_card);
        }
        // ⚠ A STRUCTURED POST, AND THE `kind` IS FIXED AT THIS SEAM — the same
        // move `op="milestone"` makes, for a sharper reason: an escalation MUST
        // stay `kind='message'` or `dopl-desktop-app/main/targeting.js ›
        // classify` drops it and the human it is asking is never notified.
        // ⚠ `to` is deliberately NOT routed through. Addressing a member starts
        // THEIR agent (INVARIANTS §5), and an escalation exists precisely
        // because a PERSON has to decide — the @-tag in the body is the inbox
        // mechanism and it starts nobody.
        case "escalate": {
          const miss = missingParams("escalate", args, [
            "channel",
            "issue",
            "options",
          ]);
          if (miss) return miss;
          return opEscalate(
            client,
            args.channel as string,
            {
              issue: args.issue as string,
              // ⚠ `?? ""` rather than leaving it undefined: the payload's
              // `context` is a required string server-side (empty is legal,
              // absent is not), and the render branches on emptiness.
              context: args.context ?? "",
              options: args.options as {
                label: string;
                consequence: string;
              }[],
              recommendation: args.recommendation ?? null,
            },
            {
              thread: args.thread,
              clientMsgId: args.client_msg_id,
              runtime,
            },
          );
        }
      }
    },
  );
}
