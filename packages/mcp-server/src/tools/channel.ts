/**
 * `dopl_channel` — cross-user, agent-to-agent collaboration channels.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one shared exchange
 * between two members; a SESSION is one member's agent run working it. Agents
 * (and users) send messages and structured activity events, then read for
 * replies. Every message has a monotonic `seq` cursor, so a listener can ask
 * for "everything after seq N" (`op="read"`, `since=`).
 *
 * ⚠ **FIVE OPS SINCE 2026-09-02 (v2 wave B slice B8, Samuel's ruling B9)** —
 * `send` · `read` · `status` · `manage` · `rooms`, down from twenty-three. The
 * other twenty-two names parsed for one release and answered ONE line naming
 * their replacement; slice B16 closed that window, so the enum is five words
 * wide at runtime as well as in the published schema and a retired name is
 * refused by `channel-schema.ts › unknownOpRefusal`.
 *
 * Thin registrar: owns the single tool schema + op routing, delegating to
 *   - `channel-shared.ts`        — ref resolution + the ONE neutralizer every
 *                                  peer-authored string must pass through
 *   - `channel-ops-write.ts`     — the send lane (+ `channel-post-linkage.ts`
 *                                  and `channel-facts.ts` for its result line)
 *   - `channel-ops-threads.ts`   — thread="new"
 *   - `channel-ops-escalate.ts`  — kind="decision"
 *   - `channel-ops-read.ts` / `channel-ops-account.ts` / `channel-ops-hold*.ts`
 *                                — the page, the account-wide page, the hold
 *   - `channel-ops-status.ts`    — sessions + the direction mailbox
 *   - `channel-dispatch-agents.ts` — op="manage"
 *   - `channel-dispatch-rooms.ts`  — op="rooms"
 *   - `channel-render.ts`        — read renderers + untrusted-content headers
 *
 * ⚠ A channel reaches PEOPLE. `to` names ONE party — a member, or one of the
 * caller's OWN agents — and the server resolves it; with one the message is a
 * REQUEST, without one it is chat and reaches nobody.
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
// The tool's two declared halves: PROSE (what a channel is, which ops exist)
// and published input SHAPE. This file is mechanism only.
import { CHANNEL_DESCRIPTION } from "./channel-description";
import { CHANNEL_INPUT_SHAPE, unknownOpRefusal } from "./channel-schema";
// ⚠ THE TWO DISPATCHERS, in siblings — see each module's header for why its
// group is one lane and why its parameter list is as narrow as it is.
import {
  dispatchManageAction,
  isManageAction,
} from "./channel-dispatch-agents";
import {
  dispatchRoomsAction,
  isRoomsAction,
} from "./channel-dispatch-rooms";
import { opRead } from "./channel-ops-read";
import { opHold } from "./channel-ops-hold";
// ⚠ WORKSPACE-WIDE hold is a SIBLING handler, not a branch inside `opHold`:
// the per-channel result vocabulary splices `ref` into every sentence, and
// threading an absent ref through it would produce guidance with a hole in it.
import { opHoldWorkspace } from "./channel-ops-hold-workspace";
// ⚠ G14's cap travels WITH the lane it bounds — the seam enforces it, the
// send lane owns the number and the sentence.
import { decisionRefusal, milestoneRefusal, opPost } from "./channel-ops-write";
import { opCreateThread } from "./channel-ops-threads";
// ⚠ A structured SEND, not a second delivery path — it delegates to `opPost`.
import { opEscalate } from "./channel-ops-escalate";
// THE ACCOUNT-WIDE READ (2026-09-01, T22) — `read` with no `channel`. ⚠ A
// SIBLING MODULE, not a branch inside the per-channel handler: its whole result
// vocabulary splices one `ref`, and its scope is one room.
import { opReadAccount } from "./channel-ops-account";
import { opStatus } from "./channel-ops-status";
import { isDesktopRun, UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import { DESKTOP_HOLD_REFUSAL } from "./channel-hold-budget";
import type { WorkspaceDirectory } from "../workspace-directory.js";

/**
 * `caller` — the session's ONE identity record (`identity.ts`), resolved once
 * at boot:
 *   - `userId` renders "· to you" instead of a uuid the agent cannot match
 *     against itself, and filters the caller's own messages out of its hold.
 *   - `runtime` decides what the wake teaching may CLAIM (from
 *     `X-Dopl-Runtime`). ⚠ An OBSERVATION that gates nothing — without it the
 *     tool promises every caller that a pending hold outlives the turn, which
 *     is measurably false for an external session.
 *
 * ⚠ Resolved at boot, never per call: a hold runs a poll loop, so an identity
 * lookup per read is a round-trip on the hottest path. Defaults to
 * {@link UNKNOWN_CALLER} — ids render as ids, no line claims to know "you", no
 * line claims a wake.
 *
 * `isAdmin` — workspace-admin flag from the boot status ping. ⚠ Used ONLY by
 * `op="rooms" action="members"` to gate member EMAIL, and defaults false
 * (fail-closed): a test registrar or a failed ping never leaks email.
 */
export function registerChannelTool(
  register: RegisterTool,
  client: DoplClient,
  caller: CallerIdentity = UNKNOWN_CALLER,
  isAdmin = false,
  // 🔒 THE CONTAINER LOCK, for the ACCOUNT-WIDE reads alone. Their routes are
  // `withUserAuth` and answer for the whole account, so the narrowing cannot live
  // there; `tools/account-scope.ts` applies it, through the one reader of the lock
  // (`workspace-directory.ts › narrowToLock`).
  // ⚠ **REQUIRED, WITH NO DEFAULT, DELIBERATELY** — and it is required even
  // though it follows two defaulted parameters. A default would mean an
  // UNNARROWED account read for any caller that forgot it, which is the
  // enumeration oracle B3 exists to deny; `dopl_status` takes the same argument
  // the same way, and `parity-harness.ts` passes a stub because capture never
  // runs a handler. `container-lock.test.ts` drives the real one through
  // `bootServer`.
  directory: WorkspaceDirectory,
): void {
  const selfUserId = caller.userId;
  const runtime = caller.runtime;
  // ⚠ WHICH SESSION, for the hold's self-echo filter ONLY (F-405). Never a gate:
  // a session id is an attribution hint any token holder can send
  // (`shared/auth/session-header.ts`), so it may decide what to SHOW and nothing
  // else. Null for every caller that sent no stamp.
  const selfSessionId = caller.sessionId;
  register(
    "dopl_channel",
    CHANNEL_DESCRIPTION,
    CHANNEL_INPUT_SHAPE,
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        // ── THE ONE WRITE ────────────────────────────────────────────────
        //
        // ⚠ THREE LANES, ONE OP, AND THE `kind` IS FIXED AT THIS SEAM rather
        // than left to the caller's spelling. `milestone` stores
        // `task_progress`; `decision` MUST stay `kind='message'` or
        // `dopl-desktop-app/main/targeting.js › classify` drops the card and the
        // human it asks is never notified. Both delegate to `opPost` rather than
        // growing a second delivery path.
        case "send": {
          const miss = missingParams("send", args, ["channel", "body"]);
          if (miss) return miss;
          const channel = args.channel as string;
          const body = args.body as string;

          // ⚠ `thread="new"` OPENS THE EXCHANGE, and it is checked FIRST because
          // it decides which ROUTE the send goes to. `summary` is the title —
          // one field, one meaning, and the create route's own `.min(1)` is what
          // refuses a whitespace-only one after trimming.
          if (args.thread === "new") {
            const missNew = missingParams('send thread="new"', args, [
              "to",
              "summary",
            ]);
            if (missNew) return missNew;
            return opCreateThread(
              client,
              channel,
              args.summary as string,
              body,
              args.to as string,
              undefined,
              args.client_msg_id,
              runtime,
            );
          }

          // ⚠ `thread` is REQUIRED here where a plain send leaves it optional —
          // an untagged milestone groups into nothing, the one shape of this
          // call that is always a mistake. ⚠ `to` is NOT routed through: a
          // milestone marks the thread and addresses nobody.
          if (args.kind === "milestone") {
            const missM = missingParams('send kind="milestone"', args, [
              "thread",
            ]);
            if (missM) return missM;
            const oversize = milestoneRefusal(body);
            if (oversize) return oversize;
            return opPost(client, channel, body, {
              kind: "task_progress",
              thread: args.thread as string,
              summary: args.summary,
              runtime,
              // ⚠ ITS OWN VERB. A milestone result opening `posted` would report
              // the wrong act on the one lane whose whole point is that it is
              // NOT a delivery — see `PostOptions.resultHead`.
              resultHead: "milestone",
            });
          }

          // ⚠ `summary` IS THE ISSUE AND `body` IS THE CONTEXT (B8). The card
          // used to take four dedicated params; two of them were the two fields
          // every send already has, under other names. ⚠ `to` is deliberately
          // NOT routed through: addressing a member starts THEIR agent
          // (INVARIANTS §5), and a decision exists precisely because a PERSON
          // has to decide — the @-tag in the body is the inbox mechanism and it
          // starts nobody.
          if (args.kind === "decision") {
            const missD = missingParams('send kind="decision"', args, [
              "summary",
              "options",
            ]);
            if (missD) return missD;
            const oversize = decisionRefusal(body);
            if (oversize) return oversize;
            return opEscalate(
              client,
              channel,
              {
                issue: args.summary as string,
                context: body,
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

          return opPost(client, channel, body, {
            clientMsgId: args.client_msg_id,
            to: args.to,
            summary: args.summary,
            thread: args.thread,
            runtime,
          });
        }

        // ── THE ONE READ, AND THE HOLD THAT USED TO BE AN OP ──────────────
        //
        // ⚠ THREE SCOPES, AND THEY ARE NOT THE SAME — do not "unify" them: a
        // read WITH a channel is ONE ROOM, a channel-less HOLD is ONE WORKSPACE,
        // and a channel-less PAGE is THE WHOLE ACCOUNT. The asymmetry is
        // deliberate: a hold re-proves its membership set per tick and that
        // proof is workspace-scoped, while a page proves once. Both scopes are
        // stated on the `channel` param.
        //
        // ⚠ `wait_ms` IS WHAT MAKES IT A HOLD, and `since` is required with it:
        // `seq` is workspace-global so one cursor is legal across every channel,
        // but a hold with no cursor is a firehose either way.
        case "read": {
          const scoped =
            args.channel !== undefined && args.channel.trim() !== "";
          if (args.wait_ms !== undefined) {
            // 🔒 THE HOLD IS EXTERNAL-ONLY, FENCED HERE AND NOT ONLY IN THE
            // DESKTOP'S PERMISSION GATE (T85). Ahead of the missing-`since`
            // check: a desktop-run caller may not have the hold at all, so
            // asking it for a cursor first would teach it to retry.
            if (isDesktopRun(caller)) return err(DESKTOP_HOLD_REFUSAL);
            const missHold = missingParams("read (holding)", args, ["since"]);
            if (missHold) return missHold;
            return scoped
              ? opHold(
                  client,
                  args.channel as string,
                  args.since as number,
                  args.wait_ms,
                  selfUserId,
                  runtime,
                  selfSessionId,
                )
              : opHoldWorkspace(
                  client,
                  args.since as number,
                  args.wait_ms,
                  selfUserId,
                  runtime,
                  selfSessionId,
                );
          }
          if (!scoped) {
            const missAcct = missingParams("read (every channel)", args, [
              "since",
            ]);
            if (missAcct) return missAcct;
            return opReadAccount(
              client,
              directory,
              args.since as number,
              args.limit,
              selfUserId,
            );
          }
          return opRead(
            client,
            args.channel as string,
            args.since,
            args.limit,
            selfUserId,
            // ⚠ Any non-empty string is legal — legacy `task-<channelId>-<seq>`
            // ids are real `metadata.taskId` values and must stay filterable.
            args.thread,
            args.response_format,
          );
        }

        // ⚠ `channel` is an OPTIONAL filter; own-scoped in the service, and the
        // transport credential IS the caller, so no identity is passed.
        case "status":
          return opStatus(client, directory, {
            channel: args.channel,
            agent: args.to,
            format: args.response_format,
          });

        // ── THE TWO DISPATCHERS ───────────────────────────────────────────
        //
        // ⚠ `action` IS REQUIRED AND THE PAIRING IS CHECKED, because it is ONE
        // flat enum over two disjoint vocabularies: the schema cannot express
        // "this word belongs to that op", so `manage(action="open")` has to be
        // refused HERE rather than dispatched into a switch that has no arm for
        // it. The refusal names the op that does take the word, which is the one
        // thing the caller cannot read off the schema.
        case "manage": {
          const missA = missingParams("manage", args, ["action"]);
          if (missA) return missA;
          const action = args.action as string;
          if (!isManageAction(action)) {
            return err(
              `op="manage" has no action "${action}" — that word belongs to op="rooms". Nothing was done. op="manage" takes "launch", "end", "rename", "posture" or "direct".`,
            );
          }
          return dispatchManageAction(action, args, client);
        }
        case "rooms": {
          const missA = missingParams("rooms", args, ["action"]);
          if (missA) return missA;
          const action = args.action as string;
          if (!isRoomsAction(action)) {
            return err(
              `op="rooms" has no action "${action}" — that word belongs to op="manage". Nothing was done. op="rooms" takes "list", "open", "invite", "members", "threads", "thread_mode", "update" or "help".`,
            );
          }
          return dispatchRoomsAction(action, args, client, selfUserId, isAdmin);
        }

        // ── THE BELT ──────────────────────────────────────────────────────
        //
        // ⚠ **UNREACHABLE BY TYPE, AND KEPT ANYWAY.** `args.op` is the five
        // published names and the five are handled above, so TypeScript narrows
        // this arm to `never` — zod refuses anything else before a handler runs,
        // with this same sentence (`channel-schema.ts › unknownOpRefusal`). What
        // it covers is a build where that validation did not happen: an
        // unrecognized op must be REFUSED, never fall through as a success.
        default:
          return err(unknownOpRefusal(args.op));
      }
    },
  );
}
