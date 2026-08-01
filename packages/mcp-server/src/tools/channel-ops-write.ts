/**
 * `dopl_channel` op="post" — send a message or a structured activity event.
 *
 * THIS FILE IS NOW ONE OP, and that is the end of a three-step split rather
 * than an accident. It began as "the write ops"; the first-class thread ops
 * left for `channel-ops-threads.ts`, the post's result LINES left for
 * `channel-post-linkage.ts` / `channel-addressing.ts` / `channel-wake-guidance.ts`
 * / `channel-post-notes.ts`, and the room-lifecycle ops (open / invite) left
 * for `channel-ops-open.ts`. What is left is the one op every behaviour round
 * actually lands on: resolve the addressing, make the call, map the 4xx, hand
 * the outcome to the modules that narrate it.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 *
 * PEER-CONTROLLED TEXT (Q1, write side). Every string below is server NARRATION
 * — no untrusted-content framing, read by the model as the tool speaking — and
 * two peer-authored values are spliced into it.
 *
 *   - `ch.name`. `resolveChannelOr` lists channels including PUBLIC ones the
 *     caller was never invited to, so the name can come from someone the agent
 *     has had no contact with; the reach is lower than `op="list"`'s (the agent
 *     must name the channel) but it is not zero. `features/channels/schema.ts`
 *     bounded it at 120 characters with NO charset rule, so it could carry the
 *     newlines that forge a line — that gap is closed there too now.
 *   - `toLabel` — `profiles.display_name`. Render-safe by the time it arrives:
 *     `resolveMemberOr` neutralizes at the source, so the label is spliced
 *     directly here and must NOT be neutralized twice.
 *
 * Peer TITLES (thread names) render in `channel-post-linkage.ts`; the
 * untrusted-content headers they carry live in `channel-render.ts` with the
 * read side's, one definition each.
 *
 * MULTIPLAYER: `to_agent` / `as_agent` are resolved through
 * `channel-agent-refs.ts`, which also owns how an agent handle is rendered (as a
 * value, and never without the immutable agent id beside it).
 */

import type {
  ChannelMessageInput,
  DoplClient,
  MessageIntent,
} from "@dopl/client";
import { ok, err, withCallerAgent, type ToolResponse } from "./respond";
// Agent identity (handle→row resolution, and how a handle is rendered) is one
// module for the whole tool — post, create_thread and get_thread share it.
import { agentLabel, resolvePostAgentsOr } from "./channel-agent-refs";
// A post's result lines each live in their own module — this one answers "did
// it thread?", which is the question a sender cannot otherwise settle.
import { closedThreadNote, threadLinkageNote } from "./channel-post-linkage";
// …and this one answers "what did the ADDRESSING do?" — the conflict note, the
// multi-address note, and the addressed/chat/unaddressed line. Split out at the
// §2 cap (SHOULD-FIX-6) beside its two existing siblings.
import {
  CHAT_ADDRESSED_REFUSAL,
  agentAttributionNotes,
  postAddressLines,
} from "./channel-post-notes";
import {
  inlineOr,
  isErr,
  metaString,
  resolveChannelOr,
  resolveMemberOr,
} from "./channel-shared";
// Whether a pending `await` can outlive the turn is a CLIENT property this
// server cannot see. One module decides what may be claimed about it.
import { postReplyLines } from "./channel-wake-guidance";
// Q9 — a 400's MEANING is read off its code, not guessed from its status. See
// channel-errors.ts for why the old status-only branch answered every failure
// with "invite them first".
import {
  AGENT_CAP_NOTE,
  FIELD_CAPS_NOTE,
  classifyBadRequest,
  classifyForbidden,
  isBadRequest,
  isForbidden,
  serverDetail,
} from "./channel-errors";

/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";

/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
  kind?: ChannelMessageInput["kind"];
  metadata?: Record<string, unknown>;
  clientMsgId?: string;
  /** Address the post to one member (email or user id, resolved like invite). */
  to?: string;
  /** One-line intent for the receiver's notification. */
  summary?: string;
  /** A thread id — threads this post under that thread's card (server-validated). */
  thread?: string;
  /**
   * MULTIPLAYER — address the post to a named AGENT (handle or id). Addressing
   * is what makes an agent act.
   *
   * IT DOES NOT ENGAGE IT WHEN THE CALLER IS THIS TOOL. `recordAgentEngagement`
   * (service-writes-agents.ts) stamps `engaged_at` only for a HUMAN-authored
   * post, and every post made through MCP is agent-authored — the write path
   * derives `author_kind` from the caller's token (`source: auth.agentTokenId ?
   * "agent" : "user"`, service-shared.ts) and an MCP call always carries one. So
   * engagement is a thing that HAPPENS TO the caller's own agents (a human tags
   * them in the web app or the desktop), never a thing this op does to a peer.
   * Narration that said otherwise would teach an agent it had put a peer on a
   * standing licence it does not have.
   *
   * Addressing a HUMAN (`to`) is NOT notify-only: see
   * {@link PostOptions.asAgent}, which is what decides that.
   */
  toAgent?: string;
  /**
   * MULTIPLAYER — the N-agent form of {@link PostOptions.toAgent}: address up to
   * eight named agents in ONE post, which is how two agents are told to work
   * together. `toAgent` is exactly its one-element case and the two merge, in
   * that order. All-or-nothing (see `resolvePostAgentsOr`), and the FIRST
   * addressed agent's owner is the member the server stamps the post for.
   */
  toAgents?: string[];
  /**
   * MULTIPLAYER — post AS one of the caller's own agents (handle or id). It
   * supplements the human author, it never replaces one, and the server
   * verifies ownership: another member's agent is a 403, never a silent drop.
   *
   * IT ALSO DECIDES TWO THINGS THAT ARE NOT ABOUT ATTRIBUTION, and both were
   * undocumented until B1/S1:
   *  - with `to`=<a person>, it is what makes the post a NOTIFICATION instead
   *    of a request that starts their agent. The receiving desktop's
   *    notify-only `agent-escalation` verdict requires `author_agent_id`
   *    (dopl-desktop-app/main/targeting.js), which is stamped ONLY from a
   *    validated `as_agent`. Without it the post classifies as `trigger`.
   *  - with `thread`, it is what admits an AGENT participant to a breakout
   *    room: `mayWriteThread` (service-writes-metadata.ts) matches the set
   *    against the CLAIMED agent, so the post 403s without it.
   */
  asAgent?: string;
  /**
   * CHAT vs REQUEST — whether this post may reach anybody's agent at all.
   * Absent means `request`, which is the whole of today's behaviour: addresses
   * work, and a DIRECT channel's auto-address still fires. `chat` is people
   * talking — the auto-address is skipped server-side, so nothing on the far
   * side reads the message as an ask.
   *
   * `chat` beside an address is a CONTRADICTION and is refused here, before the
   * call (see {@link CHAT_ADDRESSED_REFUSAL}); the route refuses it too, with
   * `CHANNEL_CHAT_ADDRESSED`.
   */
  intent?: MessageIntent;
  /**
   * The caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes
   * nothing this op does — only what the result is willing to claim about
   * waiting for the reply. See `channel-wake-guidance.ts`.
   */
  runtime?: string | null;
}

export async function opPost(
  client: DoplClient,
  channelRef: string,
  body: string,
  opts: PostOptions = {},
): Promise<ToolResponse> {
  // FIRST, and before any round-trip: a contradictory post has nothing to
  // resolve. Refusing here rather than letting the route do it means "nothing
  // was sent" is trivially true and the caller is told which two params fight.
  if (
    opts.intent === "chat" &&
    (opts.to || opts.toAgent || (opts.toAgents?.length ?? 0) > 0)
  ) {
    return err(CHAT_ADDRESSED_REFUSAL);
  }
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);

  // Resolve the addressee reference (email or user id) like invite does —
  // to a workspace member. The route then enforces channel membership.
  let toUserId: string | undefined;
  let toLabel: string | undefined;
  if (opts.to) {
    const member = await resolveMemberOr(client, opts.to);
    if (isErr(member)) return member;
    toUserId = member.userId;
    toLabel = member.label;
  }

  // MULTIPLAYER: resolve the agent identities this post names — who it is FOR
  // (`to_agent`) and who it is FROM (`as_agent`) — against this channel's
  // roster, in one round-trip, and none at all when neither is set. Resolving
  // by HANDLE is the point: an agent knows the name the room addresses it by,
  // not a uuid. Ownership is still the server's check, not ours.
  const agentAddr = await resolvePostAgentsOr(
    client,
    ch.id,
    opts.toAgent,
    opts.asAgent,
    opts.toAgents,
  );
  if (isErr(agentAddr)) return agentAddr;

  // Thread the post under a thread when `thread` is passed: fold the id into
  // the STORAGE key `metadata.taskId` (the explicit param wins over any
  // metadata copy). The route then server-validates it resolves to a thread
  // in this channel.
  const metadata = opts.thread
    ? { ...(opts.metadata ?? {}), taskId: opts.thread }
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
      // Ids, not the caller's strings: the handle was already resolved to a row
      // of THIS channel above, and the route stamps what it is given.
      //
      // The SINGLE address still goes out as `toAgent` alone, byte for byte the
      // request this tool has always sent — the server treats `toAgent` as a
      // one-element `toAgents` and merges them, so `toAgents` is added only when
      // there is genuinely more than one and nothing about a one-agent post
      // changes shape.
      toAgent: agentAddr.to?.id,
      toAgents:
        agentAddr.tos.length > 1
          ? agentAddr.tos.map((a) => a.id)
          : undefined,
      authorAgentId: agentAddr.as?.id,
      // Absent unless the caller said so: an omitted `intent` means `request`
      // and stamps no metadata key at all (service-writes-metadata.ts).
      intent: opts.intent,
    });
  } catch (e) {
    // Q9 — map the route's 400s off the CODE, not off which params happened to
    // be set. The old branch guessed: `to` set → blame the addressee, else
    // `thread` set → blame the thread, else fall through and rethrow a raw 400.
    // That is wrong whenever the route rejected the BODY (a >16000-char body, a
    // >200-char summary) — the commonest 400 of the three, and the one where
    // "invite them first" sends the agent to a contradictory second error.
    if (isBadRequest(e)) {
      switch (classifyBadRequest(e)) {
        case "addressee_not_member":
          return err(
            `Couldn't address the message to ${toLabel ?? "that member"} — they aren't a member of **${chName}**. Invite them first (op="invite"), or post without \`to\`.`,
          );
        case "thread_not_in_channel":
          return err(
            `That thread is not in this channel — check the thread id, or post without \`thread\`.`,
          );
        case "invalid_request":
          return err(
            `That post was rejected as INVALID before it reached **${chName}** — nothing was sent, and this is NOT a membership or thread problem, so do not invite anyone or change \`thread\` over it.${serverDetail(e)} ${FIELD_CAPS_NOTE} Shorten the field that is over and post again.`,
          );
        case "workspace":
          return err(
            `The post was rejected because the call carried no usable workspace.${serverDetail(e)} This is a connection-level problem, not a channel one — report it to your operator.`,
          );
        // `to_agent` / `as_agent` are resolved against THIS channel's roster
        // before the call, so the route agreeing that an agent is foreign means
        // the two reads disagree — say what the server said and re-read the
        // roster, rather than repeating a claim it just refused.
        case "agent_not_in_channel":
          return err(
            `The agent you named is not an agent of **${chName}**, so nothing was sent.${serverDetail(e)} Re-read the room's agents with dopl_channel(op="agents", channel="${ch.id}") and address one of those — a handle only ever names an agent inside ONE channel.`,
          );
        // SHOULD-FIX-4 — THE 400 THIS TOOL'S OWN SURFACE INVITES. The schema
        // publishes `to_agents.max(8)` and never says `to_agent` counts toward
        // the same eight, while the server caps the DEDUPED MERGE of the two.
        // Without this arm the refusal fell through to `unknown` — "the server
        // did not name a cause this tool recognizes" — for the one cause the
        // tool is best placed to explain.
        case "too_many_agents":
          return err(
            `That post addressed too many agents, so nothing was sent.${serverDetail(e)} ${AGENT_CAP_NOTE}`,
          );
        // The local guard at the top of this op already refuses this pair, so
        // reaching here means the two disagree — answer with the RULE, not with
        // "the server named a cause this tool does not recognize".
        case "chat_addressed":
          return err(CHAT_ADDRESSED_REFUSAL);
        // `self_target` is a create_thread-only rejection — `post to=self` is
        // deliberately NOT guarded server-side (the receiving desktop already
        // classifies a self-addressed post as noise, and a post is not a
        // thread), so this arm is unreachable and exists to keep the switch
        // exhaustive rather than to invent a cause the post never has.
        // `participant_not_member` is the same: only a thread CREATE (or a
        // join) seeds a participant set, so a post never raises it.
        case "self_target":
        case "participant_not_member":
        case "unknown":
          return err(
            `The post to **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${serverDetail(e)} Nothing was sent.`,
          );
      }
    }
    // THE TWO 403s A POST CAN GET, TOLD APART BY THEIR CODE rather than by
    // which params happened to be set. They can be raised by the same call —
    // `as_agent` + `thread` is the normal breakout-room shape — and the old
    // param-order guess reported the agent-ownership refusal for both, so a
    // thread-authorization failure came back as "that agent is not yours".
    if (isForbidden(e)) {
      const kind = classifyForbidden(e);
      // AN AGENT IDENTITY IS NOT ASSUMABLE. The server refuses `as_agent`
      // naming an agent the caller does not own; it never silently strips the
      // claim, so nothing was posted and the fix is to post as YOUR own agent
      // (op="agents" lists the room's, with their owners).
      if (kind === "agent_owner" || (kind === "unknown" && agentAddr.as && !opts.thread)) {
        return err(
          `You can't post as ${agentAddr.as ? agentLabel(agentAddr.as) : "that agent"} — an agent may only be spoken for by the member who summoned it, and the server verified this one is not yours. Nothing was posted. Post as your own agent, or without \`as_agent\`.`,
        );
      }
      if (opts.thread && kind !== "not_a_member") {
        // S1 — THE REMEDY THAT MANUFACTURED A DUPLICATE ROOM. This arm used to
        // say "that thread belongs to two other members … open your own with
        // op=create_thread", which is wrong for the commonest cause: the write
        // gate (`mayWriteThread`, service-writes-metadata.ts) lets an AGENT
        // participant of a breakout thread post only when the call CLAIMS that
        // agent with `as_agent`. A thread the agent legitimately belongs to
        // therefore 403s on the missing param, and the advice sent it away to
        // open a second room for the same work. Name the missing param first.
        // The thread id is NOT echoed into these lines. It is the caller's own
        // argument, but it round-trips: an agent copies an id out of a `read`
        // legend, and a legend id is `metadata.taskId`, which a peer sets
        // verbatim for any non-UUID value (Q1-E, the same reason close_thread
        // neutralizes it). "the id you just passed" needs no escaping and the
        // caller has the value in hand.
        return err(
          agentAddr.as
            ? `You can't post into that thread as ${agentLabel(agentAddr.as)} — nothing was posted. A thread with a participant set is a BREAKOUT ROOM and its SET decides who may write: check it with dopl_channel(op="get_thread", channel="${ch.id}", thread=<the id you just passed>). If you are not in it, ask the member who opened it (or the one it is addressed to) to admit you — do NOT open a second thread for the same work.`
            : `You can't post into that thread — nothing was posted. FIRST TRY \`as_agent\`: if what admits you to that thread is one of YOUR AGENTS being in its participant set, the server checks the set against the agent you CLAIM, so the post is refused until you name it. Re-send the same post with as_agent="<your handle>". If you are not in the set at all — dopl_channel(op="get_thread", channel="${ch.id}", thread=<the id you just passed>) shows it — ask the member who opened the thread, or the one it is addressed to, to admit you with op="join_thread". Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`,
        );
      }
      if (kind === "not_a_member") {
        return err(
          `You can't post to **${chName}** — you are not a member of that channel. Nothing was posted.`,
        );
      }
    }
    throw e;
  }

  const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
  // `toLabel` is a member label, already render-safe from its resolver. The two
  // agent clauses are assembled next door, where the rest of the addressing
  // narration lives.
  const toNote = toLabel ? `, addressed to ${toLabel}` : "";
  const { toAgentNote, asNote } = agentAttributionNotes(
    agentAddr.tos,
    agentAddr.as,
  );
  // THE ADDRESSING LINES — the conflict note, the multi-address note, and the
  // addressed/chat/unaddressed line. All three live in `channel-post-notes.ts`
  // (SHOULD-FIX-6) beside the two result-line modules this op already delegated
  // to. `landedThread` is read back off the STORED message for the same reason
  // the linkage note is: what actually landed, not what was asked for.
  const addressLines = postAddressLines({
    channelId: ch.id,
    safeChannelName: chName,
    isDirect: ch.isDirect,
    intent: opts.intent,
    toAgents: agentAddr.tos,
    toUserId,
    toLabel,
    seq: message.seq,
    landedThread: metaString(message, "taskId"),
  });
  // Q7: second line, right under the confirmation — a sender cannot otherwise
  // tell continuation from new request, and the tag drop it catches is silent.
  const linkage = await threadLinkageNote(
    client,
    ch.id,
    chName,
    message,
    opts.thread,
  );
  return withCallerAgent(
    ok(
    [
      `Posted to **${chName}** (message \`${message.id}\`, seq ${message.seq}${kindNote}${toNote}${toAgentNote}${asNote}). Readers watching with op="await" will pick it up.`,
      ...addressLines,
      ...(linkage ? [linkage] : []),
      // F6 — read off the SERVER's answer, not off anything this tool guessed.
      // A closed thread still accepts the post (decided: warn, never refuse —
      // a 403 would break the legitimate final-word-after-the-close-echo
      // pattern), so this is the only thing that tells the sender the exchange
      // it just posted into has stopped routing.
      ...(message.threadClosed ? [closedThreadNote(ch.id)] : []),
      // WAKE-V1 teaching: a posted request that no one is waiting on is where
      // the exchange dies. WHETHER the await outlives this turn is not ours to
      // assert — `channel-wake-guidance.ts` owns that, off the caller's observed
      // runtime, and it used to be promised unconditionally and falsely.
      //
      // The stop rule (M3) rides with it: "re-arm on timeout" with no exit loops
      // forever over an abandoned exchange — but a plain timeout COUNTER would
      // abandon a peer that is legitimately heads-down for 20+ minutes. The exit
      // is the THREAD's state, checked periodically.
      ...postReplyLines(
        ch.id,
        message.seq,
        opts.runtime ?? null,
        `Keep re-arming while the exchange is alive; an agent working a real task can be quiet for a long stretch. Every ~3 empty holds, check first (op="read" for new activity — a working agent posts task_progress as it goes; op="get_thread" for status). Judge that on the member you addressed alone: in a channel with others, their traffic is not evidence YOUR exchange is alive. STOP and report to your operator when the thread is closed or failed, or when nothing has come from that member for ~30+ minutes.`,
      ),
    ].join("\n"),
    ),
    // LOCUS: this call spoke as an agent, so the `_dopl_status` footer says so.
    // Threaded through the RESULT rather than stamped on the session identity —
    // `as_agent` is per call, and a session may hold several agents.
    agentAddr.as ? { id: agentAddr.as.id, name: agentAddr.as.name } : null,
  );
}

