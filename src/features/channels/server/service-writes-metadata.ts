import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelMemberRow, ChannelRow, ChannelThreadRow } from "./dto";
import { ChannelThreadNotInChannelError, ThreadForbiddenError } from "./errors";
import * as repo from "./repository";
import * as repoThreads from "./repository-threads";
import {
  isLegacyThreadParticipant,
  isThreadParticipant,
} from "./service-writes-metadata-thread";
import { takeCalmFlags } from "./service-writes-metadata-markers";
import { addressedMentionStamp, resolveBodyMentions } from "./service-writes-metadata-mentions";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import { CITES_METADATA_KEY, CITE_MODE_METADATA_KEY } from "../lib/cites";
import { resolveCites } from "./service-writes-metadata-cites";
// ⚠ The outside-session vocabulary, stated once — the reserved key names (`via`: the client).
import { DESKTOP_TO_METADATA_KEY, EXTERNAL_SESSION_METADATA_KEY } from "../lib/desktop-handle";
import { VIA_METADATA_KEY } from "../lib/message-via";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
} from "../escalation";
import {
  resolveEscalation,
  resolveEscalationAnswer,
  resolveTypedEscalationAnswer,
} from "./service-writes-metadata-escalation";
import type { ChannelContext } from "./service-shared";
import { SERVER_STAMPED_DEVICE_KEYS } from "./service-writes-device";

/**
 * ONE place that decides what lands in `channel_messages.metadata`.
 *
 * RESERVED KEYS — always stripped from caller metadata, re-added only from
 * server-validated values: `to_user_id`, `summary`, `runtime`, `appVersion`,
 * `session_id`, `to_user_notify`, `threadMode`, `threadCreatedBy`, `threadTitle`,
 * `threadTarget`, `to_agent_id`, `to_agent_ids`, `author_agent_id`, `intent`,
 * `handoff`, `fanoutGroup`, `mentionedUserIds`, `escalation`,
 * `escalationAnswer`, `assignedTaskId`, `source`, `display`, and the six calm-terminal flags. ⚠ The two close-proposal keys and `threadReopened` LEFT this list with
 * thread closing (wiring plan Phase 4, 2026-08-18) — no writer and, unlike the
 * dead agent keys below, no RENDERER either.
 * `service-writes-metadata-markers.ts` records why. `threadId` stays
 * caller-settable, but every thread id — first-class or legacy — must BELONG to
 * the poster (see {@link resolvePostMetadata}). Marker keys live in
 * `service-writes-metadata-markers.ts`, the thread half in
 * `service-writes-metadata-thread.ts`.
 *
 * ⚠ The three agent keys have no writer left but MUST stay in the strip list:
 * `author_agent_id` is what the transcript reads to attribute an old message to
 * a handle, so a caller who could set it could attribute its own words to
 * somebody's retired agent. Stored rows keep theirs and keep rendering.
 * ⚠ **AND THEY ARE NOT THE `toAgent` / `authorAgentId` ROUTE TOMBSTONES, WHICH
 * WERE DELETED ON 2026-09-02.** Those were parameters with a delete-me clock;
 * these are reserved NAMES, and dropping one is a widening, not a cleanup. The
 * two are named together in one v2 spec row, which is what **F-434** exists to
 * separate — read it before deleting anything here.
 */

// ⚠ THE TWO DM INHERITANCE RESOLVERS MOVED TO
// `service-writes-metadata-inherit.ts` (2026-09-14, 500-line cap), beside the
// test file that already carried that name. Fold 4 is unchanged.
import {
  resolveDirectPeer,
  resolveInheritableThread,
} from "./service-writes-metadata-inherit";
// ⚠ THE TWO SHAPES MOVED (§2 split, 2026-10-11): this file was 529 lines against a 500-line
// `error` cap, and it sat at EXACTLY 500 at the review base — the 29 lines that took it over
// were its entire headroom. `service-writes-metadata-types.ts` holds the two interface
// declarations verbatim. `import type`, so it is erased and there is no runtime edge.
import type {
  PostMetadataResult,
  PostMetadataOptions,
} from "./service-writes-metadata-types";


/**
 * Build the stored `metadata` for a post. ⚠ `input.toUserId` must ALREADY have
 * passed the addressee-is-a-channel-member check — the caller runs it, so a bad
 * addressee 400s before the idempotency short-circuit.
 *
 * Server-owned folds, in order:
 *
 * 1. **Anti-spoof strip.** `to_user_id` / `summary` settable ONLY via the
 *    validated top-level fields — a raw metadata copy bypasses both the
 *    addressee-membership check and the schema's summary cap.
 * 1b. **Intent.** Stamped only when supplied; absent stamps no key. `chat`
 *    turns fold (2) OFF. Stamped rather than merely acted on so the receiving
 *    side can tell a deliberate CHAT from a message that forgot to address, and
 *    never "repairs" it as a delivery failure.
 * 2. **Addressing is EXPLICIT, at every channel shape.** `metadata.to_user_id`
 *    comes from the validated `input.toUserId` and from nowhere else. ⚠ The DM
 *    auto-address fallback (direct channel + no caller `to` → stamp the peer)
 *    was RETIRED 2026-08-18: a post that names nobody reaches nobody's agent, in
 *    a DM exactly as in a group channel. `resolveDirectPeer` survives for fold
 *    (3) — thread inheritance — and `intent:"chat"` still skips it, so a chat
 *    post never inherits an open thread either.
 * 3. **Thread keys.** Reserved four stripped and re-stamped from the resolved thread
 *    row, so `threadMode` reflects the latest `set_thread_mode` and can't be
 *    spoofed. `threadId` stays caller-settable: a UUID resolving to no thread in
 *    THIS channel is rejected; a legacy `thread-<uuid>-<seq>` resolves to no row
 *    and stamps none of the four (titleless card is the tell). A caller
 *    `threadId` SUPPRESSES inheritance; inheritance fires only for a plain
 *    `message` in a DM addressed to the peer, since a thread id on a lifecycle
 *    marker would land an unrelated `thread_failed` on that thread's card.
 * 4. **Thread participation.** ⚠ Resolving in this channel is NOT enough — any
 *    member can read any thread id, and a stamped `threadId` puts the message
 *    inside that thread's card AND routes it to the responder's session window.
 *    The two id shapes fail differently on purpose:
 *    - First-class (UUID): must be `created_by` / `target_user_id`, else 403
 *      ({@link isThreadParticipant}). ⚠ Refused, never silently unthreaded — a
 *      message the author believes landed and the recipient never sees is the
 *      invisible-delivery failure this feature exists to prevent.
 *    - Legacy (`thread-<channelId>-<seq>`): {@link isLegacyThreadParticipant} —
 *      this channel's id, positive seq, poster inside the opener's
 *      {author, to_user_id} pair, either direction. Anything else has the tag
 *      STRIPPED and posts untagged. ⚠ NEVER throws: installed desktop posts
 *      legacy ids for lifecycle events, some against openers with no
 *      `to_user_id` at all, and a 403 would reject real posts from the field.
 *    Inherited ids need no check — their pair is {author, peer} by construction.
 * 5. **Runtime stamp.** Stripped unconditionally, re-stamped from `ctx.runtime`
 *    (auth layer resolved it from `X-Dopl-Runtime` and bounded it by the
 *    credential via `narrowRuntime`). Two values reach here: `desktop-session`
 *    and `desktop-ui` (SESSION credential only; agent tokens refused upstream).
 *    ⚠ No recognized header → no key, which is what stops an external MCP post
 *    from opening anything on the sender's machine. Single stamping point
 *    because desktop reads the key to decide whether to open a requester window.
 * 6. **App-version stamp.** Same terms, from `X-Dopl-App-Version` (via
 *    `ctx.appVersion`). Exists because electron-updater installs on QUIT and a
 *    background listener never quits, so a peer can run a stale build forever.
 *    ⚠ Purely diagnostic — nothing may gate on it (see `app-version-header.ts`).
 * 6b. **Session stamp.** `session_id` from `X-Dopl-Session-Id`. One account's
 *    credential can be held by any number of concurrent sessions, so "the agent
 *    said X" was not well-formed. ⚠ A LABEL, NOT A LOCK — nothing enforces one
 *    live session; a session sending no header is simply unattributed.
 * 7. **Calm-terminal flags.** Re-stamped only when a thread tag the poster is
 *    entitled to survived (4); a flag on a foreign thread drops with its tag.
 *
 * ⚠ Folds 7b (the `threadReopened` marker) and 8 (the closed-thread notice read
 * off the resolved row's `status`) were DELETED with thread closing (wiring plan
 * Phase 4, 2026-08-18).
 * 9. **Mentions.** `mentionedUserIds` stripped unconditionally and re-stamped
 *    ONLY from the server's own parse of `input.body` against this channel's
 *    roster (`service-writes-metadata-mentions.ts › resolveBodyMentions`, over
 *    the one parser in `lib/mentions.ts`). ⚠ Reserved on `fanoutGroup`'s terms:
 *    the set decides whose Tags inbox a message lands in and Phase 7 gates
 *    NOTIFICATIONS on it, so a caller-settable value is a notification-forgery
 *    primitive. ⚠ NOT an addressing key and NOT gated on a thread tag — a
 *    mention in a plain channel post counts, and it still triggers nobody's
 *    agent. Stamped only when the set is non-empty, so no existing row shape
 *    moves.
 * 10. **Escalation.** `escalation` stripped unconditionally and re-stamped only
 *    from the validated `input.escalation` field. Reserved on `fanoutGroup`'s
 *    terms and for the same kind of reason: the card it renders carries OPTION
 *    BUTTONS that write back and wake an agent, so a caller-settable key would
 *    let anybody hang a working control off anybody's words.
 * 11. **Escalation answer.** `escalationAnswer` stripped unconditionally and
 *    re-stamped only after the named escalation is proved to be an answerable
 *    one IN THIS CHANNEL and the caller is proved to be one of the members it
 *    asked. ⚠ Its `agentId` — the wake key — is DERIVED from the escalation's
 *    own `client_msg_id` stamp and is never accepted from the caller. Both
 *    checks live in `service-writes-metadata-escalation.ts`, which is a §1 split
 *    rather than a fold here because it READS ANOTHER ROW and enforces an
 *    authorization.
 * 11b. **A TYPED escalation answer** (2026-09-05, task 13b). A HUMAN post that is
 *    not itself a card, whose whole body IS an option's label (or its 1-based
 *    number) on the typist's most recent OPEN card in this channel, stamps the
 *    same key the same way a button press does. ⚠ It can only ever ADD the
 *    stamp: every near miss — partial text, two candidates, no open card, a
 *    lookup that failed — leaves an ORDINARY MESSAGE, silently, because a wrong
 *    match presses a button the person did not press.
 */
export async function resolvePostMetadata(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput,
  opts: PostMetadataOptions = {}
): Promise<PostMetadataResult> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  let threadTagStripped = false;
  let typedEscalationAnswer = false;
  // ⚠ ONE roster read per post, AT MOST, and only if something asks. Two folds
  // want `channel_members` — thread inheritance (3) and mention resolution (9)
  // — and neither runs on the common post. Memoized on the PROMISE so two
  // concurrent asks share one round trip.
  let rosterPromise: Promise<ChannelMemberRow[]> | null = null;
  const roster = () => (rosterPromise ??= repo.listMembers(channel.id));
  delete metadata.to_user_id;
  // Stripped, never re-stamped: consumer is gone, but a name the docs call
  // server-owned must not stay forgeable.
  delete metadata.to_user_notify;
  delete metadata.summary;
  delete metadata.runtime;
  delete metadata.appVersion;
  // ⚠ Stripped, never re-stamped. Nothing writes these any more, but the strip
  // keeps a new post from FORGING the attribution an old row legitimately has.
  delete metadata.to_agent_id;
  delete metadata.to_agent_ids;
  delete metadata.author_agent_id;
  delete metadata.intent;
  // ⚠ Stripped UNCONDITIONALLY: a caller able to set this could attribute its
  // own post to somebody else's session — the forensic question the key answers.
  delete metadata.session_id;
  // ⚠ THE SERVER'S OWN VOICE ABOUT ITS OWN CHOICE (2026-09-04). `wake_reason`
  // says WHY an agent nobody named was picked (RR3's arm), and the read renders
  // it beside the recipient. A caller able to set it could narrate a repair that
  // never happened — "→ @x (most recent)" over a post that reached nobody. Never
  // re-stamped here: `service-writes.ts` writes it from the VERDICT, after the
  // fold, because only the verdict knows the answer.
  delete metadata.wake_reason;
  // ⚠ **THE TWO OUTSIDE-SESSION KEYS, STRIPPED ON `to_user_id`'s TERMS**
  // (2026-09-18). `to_desktop` is an ADDRESS — a caller able to set it could put
  // its words on another operator's `dopl_status` board. `external_session` is
  // an ATTRIBUTION, and the whole basis of the "outside session for <operator>"
  // label, so a settable copy would let either kind pose as the other.
  // ⚠ **BOTH ARE RE-STAMPED IN `service-writes.ts`, NOT HERE — the `wake_reason`
  // precedent, not an exception to this file's charter.** Each needs a fact this
  // fold does not hold: the RESOLVER's answer, and the settled `authorKind`
  // (computed after this fold, and it may ESCALATE a cookie session's claim,
  // F-580). Re-deriving the author kind here off `ctx.source` would be a second
  // definition of "is this an agent post" that disagrees with the first for the
  // desktop's own cookie-lane agent posts.
  delete metadata[DESKTOP_TO_METADATA_KEY];
  delete metadata[EXTERNAL_SESSION_METADATA_KEY];
  delete metadata[VIA_METADATA_KEY]; // same terms: a settable copy could wear "via Claude" verified
  // ⚠ Desktop reads `handoff` to decide whether to OPEN A WINDOW, so a
  // caller-set value could open a session on the operator's machine without
  // going through validated `create_thread`. Re-stamped only from `opts` below.
  delete metadata.handoff;
  // ⚠ Same terms as `handoff`: the transcript groups every opening message
  // sharing this id into ONE request card, so a settable group id is a way to
  // render your own thread inside somebody else's request.
  delete metadata.fanoutGroup;
  delete metadata.assignedTaskId;
  // ⚠ Same terms as `fanoutGroup`, one step sharper: this key decides whose
  // Tags inbox the message lands in (and, from Phase 7, who gets notified), so
  // a caller able to set it could put its words in anybody's inbox without
  // naming them. Re-stamped from the server's own parse below.
  delete metadata[MENTIONS_METADATA_KEY];
  // ⚠ **THE TWO CITATION KEYS, ON `mentionedUserIds`' TERMS** (grammar B,
  // 2026-10-12). `cites` is what a pill POINTS AT, so a settable copy would let a
  // post aim a reader at a row the server never checked it could see — the same
  // shape of hole as a settable mention list, one indirection further. Re-stamped
  // below from the server's own resolution.
  // ⚠ `citeMode` is stripped here AND written authoritatively at the funnel
  // (`repository-messages.ts › insertMessage`). Both, deliberately: absence
  // cannot be forged, but a caller setting it could otherwise opt a NEW message
  // back into legacy prose pills, and this is the half that reads as a rule
  // rather than a side effect of the insert.
  delete metadata[CITES_METADATA_KEY];
  delete metadata[CITE_MODE_METADATA_KEY];
  // ⚠ Same terms as `fanoutGroup`, and the sharpest of the family: the card this
  // key renders carries OPTION BUTTONS that write back and wake an agent. A
  // caller able to set it could hang a working control off anybody's words, and
  // the ANSWER key could aim a wake at an agent that never asked anything.
  delete metadata[ESCALATION_METADATA_KEY];
  delete metadata[ESCALATION_ANSWER_METADATA_KEY];
  // ⚠ Device-aware keys: re-stamped in `service-writes.ts` (needs the settled author kind).
  for (const key of SERVER_STAMPED_DEVICE_KEYS) delete metadata[key];
  const calmFlags = takeCalmFlags(metadata);

  // Only when supplied — absent stamps no key, and absence reads as `request`.
  if (input.intent) metadata.intent = input.intent;

  // ⚠ From the request HEADER, never the payload. `ctx.runtime` is already
  // NARROWED (unrecognized label, or `desktop-ui` from an agent token, arrives
  // undefined).
  if (ctx.runtime) metadata.runtime = ctx.runtime;
  if (ctx.appVersion) metadata.appVersion = ctx.appVersion;
  // Verbatim — shape already checked by `session-header.ts`.
  if (ctx.sessionId) metadata.session_id = ctx.sessionId;

  // ⚠ THE VALIDATED FIELD, WITH NO FALLBACK BEHIND IT. There is no shape of
  // channel in which the server picks an addressee the caller did not name.
  const toUserId = input.toUserId;
  if (toUserId) metadata.to_user_id = toUserId;
  if (input.summary) metadata.summary = input.summary;

  delete metadata.threadMode;
  delete metadata.threadCreatedBy;
  delete metadata.threadTitle;
  delete metadata.threadTarget;

  const callerThreadId =
    typeof metadata.threadId === "string" && metadata.threadId.trim().length > 0
      ? metadata.threadId
      : undefined;
  // Dropping a blank/non-string tag here is what lets everything below read
  // `metadata.threadId` as "an ACCEPTED thread tag".
  if (!callerThreadId) delete metadata.threadId;

  let thread: ChannelThreadRow | null = null;
  if (callerThreadId) {
    if (isUuid(callerThreadId)) {
      thread = await repoThreads.findThreadByChannelAndId(channel.id, callerThreadId);
      if (!thread) throw new ChannelThreadNotInChannelError(callerThreadId);
      // Membership in the channel is not membership in the THREAD.
      if (!isThreadParticipant(thread, ctx.userId)) {
        throw new ThreadForbiddenError("post into this thread");
      }
    } else if (
      !(await isLegacyThreadParticipant(channel.id, callerThreadId, ctx.userId))
    ) {
      // ⚠ A legacy id that is not the poster's own exchange is STRIPPED, never
      // refused — the post lands untagged, silently. The installed desktop that
      // sends these ids has no diag lane to show a refusal on.
      // ⚠ SILENTLY TO THE CALLER, BUT NOT TO THE VERDICT (2026-09-02, B4): see
      // {@link PostMetadataResult.threadTagStripped}. The post is not a main-room
      // post that forgot to address anybody, and the resilience arms must not
      // treat it as one.
      delete metadata.threadId;
      threadTagStripped = true;
    }
  } else if (
    toUserId &&
    (input.kind ?? "message") === "message" &&
    // ⚠ Resolved LAZILY, and only for a post that could inherit: with the
    // auto-address fallback gone this roster read has one reader left, and a
    // group-channel or threaded post must not pay for it. `chat` never resolves
    // a peer AT ALL, which is what keeps a chat post out of an open thread.
    input.intent !== "chat"
  ) {
    const peerUserId = await resolveDirectPeer(channel, ctx.userId, roster);
    if (peerUserId && toUserId === peerUserId) {
      thread = await resolveInheritableThread(channel, ctx.userId, peerUserId);
      if (thread) metadata.threadId = thread.id;
    }
  }

  if (thread) {
    metadata.threadMode = thread.mode;
    metadata.threadCreatedBy = thread.created_by;
    metadata.threadTitle = thread.title;
    // Null target (unaddressed thread) stamps nothing — desktop's suppression
    // predicate then cannot match and falls through to the trigger rules.
    if (thread.target_user_id) metadata.threadTarget = thread.target_user_id;
  }

  // ⚠ TWO GATES, BECAUSE THE SIX CALM FLAGS ANSWER TWO DIFFERENT QUESTIONS
  // (2026-10-11). Both re-stamp from a SERVER-held value only; neither admits a
  // caller's claim.
  //
  //  · FIVE OF THEM (`declined` / `dropped` / `interrupted` / `capped` /
  //    `ended`) describe a THREAD outcome, so they re-stamp only for the
  //    thread's own participants — the same question as "did a thread tag
  //    survive the gate above". Anything else (a foreign thread, unresolvable
  //    id, no thread) has no `threadId` left, so a fabricated outcome has nothing
  //    to attach to.
  //  · `session_ended` IS NOT A THREAD OUTCOME, and gating it on a thread tag
  //    was always wrong — `service-writes-metadata-markers.ts` says in as many
  //    words that it is about ONE SESSION ending, rides a `thread_progress` rather
  //    than a `thread_failed`, and is not read by `calmTerminalStatus`. The cost
  //    was silent and total: a CHANNEL-LEVEL session (`<channel>::<agent>`,
  //    no thread tag) could never report that it had stopped, so every such row
  //    in prod carries `session_ended` NULL while every
  //    `<channel>:<thread>:<agent>` row carries it. It now re-stamps on the
  //    stamped `metadata.session_id` — the thing it actually describes —
  //    INDEPENDENT of any thread tag.
  //
  // ⚠ UNFORGEABLE ON THE SAME TERMS AS THE OTHER FIVE: `session_id` was deleted
  // from caller metadata above and re-stamped from `ctx.sessionId`, which comes
  // from the `X-Dopl-Session-Id` header and never from the payload. NO SESSION
  // ID => NO RE-STAMP, so a caller cannot narrate the end of a session it is not
  // running, and a post that carries neither a session id nor a thread tag
  // stamps nothing at all.
  if (calmFlags.length > 0) {
    const inOwnThread = typeof metadata.threadId === "string";
    const inOwnSession = typeof metadata.session_id === "string";
    for (const key of calmFlags) {
      if (key === "session_ended" ? inOwnSession : inOwnThread) {
        metadata[key] = true;
      }
    }
  }

  // Spawn-with-handoff, same discipline: only onto a thread tag the poster is
  // entitled to (the opening message always is). ⚠ ROUTING HINT, NOT an
  // authorization — desktop still requires the identity pair (author === me,
  // thread creator === me), so a peer-attached `handoff` opens nothing on anyone
  // else's machine. Literal boolean, read `=== true` on the desktop.
  if (opts.handoff === true && typeof metadata.threadId === "string") {
    metadata.handoff = true;
  }

  // Fan-out group, same discipline and the same condition: it only ever rides
  // the opening message of a thread the poster just created, so a tag that did
  // not survive the participation gate above takes the group with it.
  if (opts.fanoutGroupId && typeof metadata.threadId === "string") {
    metadata.fanoutGroup = opts.fanoutGroupId;
  }
  if (opts.assignedTaskId) metadata.assignedTaskId = opts.assignedTaskId;

  // MENTIONS — the server's own parse, never the caller's claim. ⚠ Deliberately
  // NOT conditioned on a surviving thread tag, unlike `handoff` / `fanoutGroup`:
  // those two are claims ABOUT a thread, and this is a claim about the BODY,
  // which stands on its own in a plain channel post. Empty stamps no key.
  // ⚠ `ctx.source` decides whether the AUTHOR survives the resolution: an agent
  // tagging its own operator is that agent's escalation path, a human tagging
  // themselves is not an inbox item. The credential answers it, never the body —
  // see `service-writes-metadata-mentions.ts`.
  // ⚠ TWO ANSWERS OFF ONE RESOLUTION SINCE 2026-09-07: the STAMPED id set, and the member
  // HANDLES the agent door mints around. See `PostMetadataResult.memberHandles` — the second is
  // carried rather than re-derived because the reads behind it are already spent.
  const mentions = await resolveBodyMentions(
    input.body,
    ctx.userId,
    roster,
    ctx.source === "agent"
  );
  const mentioned = await addressedMentionStamp(input.body, mentions.userIds, opts, ctx, roster);
  if (mentioned.length > 0) {
    metadata[MENTIONS_METADATA_KEY] = mentioned;
  }

  // CITATIONS (12). ⚠ **STAMPED ONLY WHEN THERE IS SOMETHING TO STAMP, AND THE
  // ABSENCE IS NOT A GAP.** `citeMode` alone already says "written under grammar
  // B, cited nothing" — the renderer's empty-allowlist state — so an empty
  // `cites` array would be a second way to spell the same thing.
  // ⚠ **IT CAN THROW, LIKE THE ESCALATION ANSWER BELOW**, and that is the
  // design: an unresolvable citation refuses the send rather than storing prose
  // whose reference is already dead.
  const cites = await resolveCites(channel.id, input.cites);
  if (cites.length > 0) {
    metadata[CITES_METADATA_KEY] = cites;
  }

  // ESCALATION (10) and its ANSWER (11). ⚠ The answer runs LAST because it is
  // the only fold that can THROW an authorization error, and a post refused
  // there must not have been able to change anything on the way past.
  resolveEscalation(input, metadata);
  if (input.escalationAnswer) {
    await resolveEscalationAnswer(
      channel.id,
      ctx.userId,
      input.escalationAnswer,
      metadata
    );
  } else if (!input.escalation && !input.display && ctx.source !== "agent") {
    // 11b — THE TYPED ANSWER (task 13b). A member who TYPES an option's label
    // instead of pressing it has answered the card, and until now that message
    // tied to nothing and woke nobody.
    //
    // ⚠ HUMAN SOURCES ONLY, and that is a FENCE rather than a scoping accident.
    // An agent posts as its operator's user id, so an agent that happens to
    // write "Ship now" would otherwise press its own operator's open card — a
    // button nobody touched, which is the exact failure #1085 chose silence to
    // avoid. The credential answers it, never the body, like mentions above.
    //
    // ⚠ AND NEVER ON A POST THAT IS ITSELF A CARD: an escalation's own body is
    // the render of its options, so a two-option card whose body begins with a
    // label could otherwise answer the card before it.
    // ⚠ REPORTED, not merely done — see {@link
    // PostMetadataResult.typedEscalationAnswer}. The insert has to be able to
    // tell a key this server guessed from one the caller pressed.
    typedEscalationAnswer = await resolveTypedEscalationAnswer(
      channel.id,
      ctx.userId,
      input.body,
      metadata
    );
  }

  return {
    metadata,
    threadTagStripped,
    memberHandles: mentions.memberHandles,
    typedEscalationAnswer,
  };
}
