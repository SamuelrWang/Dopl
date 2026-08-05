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
 *   - `channel-ops-open.ts`   — open / invite (the ROOM and who is in it; split
 *                               off at the §2 cap)
 *   - `channel-ops-write.ts`  — post, plus `channel-post-notes.ts` /
 *                               `channel-post-linkage.ts`, which own the
 *                               result lines a post's addressing and threading
 *                               produce
 *   - `channel-ops-threads.ts`— create_thread / close_thread / set_thread_mode
 *   - `channel-render.ts`     — the read renderers + the untrusted-content
 *                               headers, which the write side now shares
 *
 * REMOVED in the channels rollback (§1, 2026-08-05): `channel-ops-agents.ts`
 * (agents / summon_agent / rename_agent / set_agent_status / disengage_agent /
 * join_thread / leave_thread), `channel-agent-refs.ts` and
 * `channel-render-agents.ts` (agent-handle resolution and rendering) and
 * `channel-handshake-key.ts` (the two-agent thread-open key). A channel reaches
 * PEOPLE; the only distinction a post makes is `intent` chat vs. request.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The ops
 * and params here say `thread`; `channel_tasks`, `metadata.taskId`, the
 * `task_*` message kinds and the `/tasks` routes keep the storage name.
 *
 * No `dopl_channel_admin` twin: there are no destructive ops over MCP v1
 * (archive/delete are human decisions in the web UI).
 */

import type { DoplClient } from "@dopl/client";
import { missingParams, type RegisterTool, type ToolResponse } from "./respond";
// The tool's two declared halves, each its own module since the §2 split: the
// PROSE (what a channel is, THE LAW, what every op does) and the published
// input SHAPE (params, caps, per-param teaching). This file is mechanism only.
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
import { opInvite, opOpen } from "./channel-ops-open";
import { opPost } from "./channel-ops-write";
import {
  closeThreadIsHumansToMake,
  opCreateThread,
  opProposeClose,
  opSetThreadMode,
} from "./channel-ops-threads";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";

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
        // P0-3 (2026-08-04) — THE MILESTONE IS ITS OWN OP, and the fixing of the
        // kind happens HERE, at the routing seam, exactly like `open`'s
        // `direct` branch. That is the whole point of the op: neither call makes
        // the agent pick a `kind`, so "mark a milestone" and "send a reply"
        // cannot be confused by choosing wrongly between enum values that sit
        // one apart. `thread` is REQUIRED where `post` leaves it optional — an
        // untagged milestone groups into nothing, which is the one shape of this
        // call that is always a mistake.
        //
        // It delegates to `opPost` rather than growing a second delivery path:
        // one set of error narration, one result-line vocabulary, and the lines
        // a post produces (did it thread? who was addressed?) are exactly the
        // ones a milestone's author needs. `to` / `to_agent` / `to_agents` are
        // NOT routed through — a milestone marks the thread, it addresses nobody.
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
        // READ-SESSION-STATE (rollback §3.5). `channel` is an OPTIONAL filter —
        // omitted, it lists every session of the caller's — so no missingParams
        // check. Own-scoped in the service; no identity is passed here because
        // the transport's own credential is the caller.
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
            // SPAWN-WITH-HANDOFF (rollback §3.5) — a create that DECLARES it
            // opens the driving session on the operator's own machine.
            args.handoff,
          );
        }
        // DECISION 2 (2026-08-04) — PROPOSE-THEN-CONFIRM. An agent's terminal act
        // on a thread is a PROPOSAL its operator confirms; the close itself is a
        // human's, because closing settles the SHARED thread for both members and
        // the operator may still have things to say in it.
        case "propose_close": {
          const miss = missingParams("propose_close", args, [
            "channel",
            "thread",
            "outcome",
          ]);
          if (miss) return miss;
          return opProposeClose(
            client,
            args.channel as string,
            args.thread as string,
            args.outcome as "completed" | "failed",
            args.summary,
          );
        }
        // …and the op it replaces is answered rather than removed. Dropping
        // `close_thread` from the enum would turn every call an older agent makes
        // into a zod "invalid enum value", which is the one moment it most needs
        // to be told what to do instead. The server refuses an agent-token close
        // too (`ThreadCloseIsHumanOnlyError`), so this is teaching, not the gate.
        case "close_thread":
          return closeThreadIsHumansToMake();
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
