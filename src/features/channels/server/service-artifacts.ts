import "server-only";
import type {
  ChannelArtifact,
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";
import type { ArtifactActionInput } from "../schema-artifacts";
import { ChannelError } from "./errors-base";
import { ChannelForbiddenError } from "./errors";
import { mapArtifactRow } from "./dto";
import * as repoArtifacts from "./repository-artifacts";
// ⚠ **THE HYDRATOR COMES FROM `service-shared.ts`, AND THAT IS THE CYCLE FIX
// LANDING** (2026-09-06). It was imported from `service-reads.ts` for one
// slice, with the remedy written at both ends; the fold is now wired into that
// file's read, so `service-reads` imports THIS one. Moving the hydrator DOWN
// keeps the arrows one-way — this file must never import `service-reads` again.
import {
  hydrateMessages,
  loadVisibleChannel,
  requireMemberChannel,
  type ChannelContext,
} from "./service-shared";

/**
 * ARTIFACTS — a THREAD FORMED AFTER THE FACT. The authz, the four actions, and
 * the fold that turns a page of messages into a page of ENTRIES.
 *
 * Design: Mobile Command Center #1220, accepted WHOLESALE by Samuel at #1222;
 * archived as KB "Artifacts design v1". Storage: migration `20260926120000`.
 *
 * ⚠ **THE GATE IS THE CHANNEL'S OWN, AND NOT BECAUSE NOBODY GOT TO IT.** Design
 * §8 deliberately did not invent server-side authorization beyond "messages you
 * can already read", because the personal-resources work (task 11) was landing
 * rules in that area and a second answer written here would be the
 * second-authority shape this tree keeps filing bugs about. So every entry
 * point below funnels through `loadVisibleChannel`, the same gate the transcript
 * uses, and there is no artifact-specific visibility rule to drift from it.
 *
 * ⚠ **NOTHING HERE TOUCHES THE PERSONAL-SHELF FENCE** (`shared/tenancy/
 * personal-reach.ts`), and that is correct rather than an omission: that fence
 * answers "may this caller reach their own personal CONTAINER", and an artifact
 * is channel-scoped — it folds rows in `channel_messages`, which the room's own
 * membership already governs. Adding a container question to a channel read
 * would be the second authority §8 warns about. Nothing in this file weakens a
 * pin in `personal-reach.test.ts`, `personal-arming.test.ts` or the
 * resolve-resource tests; none of those paths is reached.
 */

/** The artifact ref did not resolve INSIDE this channel. ⚠ Never leaks whether
 *  it exists elsewhere — ids are not probeable across rooms. */
export class ArtifactNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Artifact not found: ${ref}`);
  }
}

/**
 * WHAT A CREATE ACTUALLY DID.
 *
 * ⚠ **`folded` MAY BE SHORTER THAN `requested`, AND SAYING SO IS THE CONTRACT**
 * (design §5: create "answers the artifact id and what it actually folded,
 * which may be fewer than asked"). A seq that does not exist, belongs to another
 * channel, or is already in another artifact simply does not fold. Reporting the
 * count alone would let a caller believe it boxed a run it only half boxed.
 */
export interface ArtifactWriteResult {
  artifact: ChannelArtifact;
  requested: number[];
  folded: number[];
  /**
   * ⚠ **THE MEMBER LIST BEHIND `folded` WAS CLIPPED** — the same signal
   * {@link readArtifact} carries, and required here for the same reason
   * (INVARIANTS §9): at the ceiling is indistinguishable from over it, so a
   * clipped list that renders like an exhausted one is the bug.
   *
   * ⚠ Only the IDEMPOTENT-CREATE converge path can ever set it true. Every
   * other write reports what one statement returned — a fold bounded by the
   * seqs asked for, an un-box of one, a dissolve of all — and none of those
   * reads `ARTIFACT_MEMBER_LIMIT`. It is stated as `false` at those sites
   * rather than left off, because an absent flag is how "we did not check"
   * comes to read as "it is complete".
   */
  truncated: boolean;
}

/**
 * 🔒 **WRITES REQUIRE MEMBERSHIP, READS REQUIRE VISIBILITY.**
 *
 * ⚠ A JUDGMENT CALL, NAMED: the design says creating is free "over messages it
 * can already read", and in a PUBLIC channel a non-member can read the
 * transcript. Letting that reader fold the room's history would be an outsider
 * writing a view decision onto somebody else's room — a stronger power than the
 * reading it was derived from. So the four write actions need a membership row
 * and `op=read, artifact=<id>` does not. If Samuel wants the looser reading, it
 * is one predicate — `service-shared.ts › requireMemberChannel`, which the four
 * writes below call and `readArtifact` deliberately does not.
 *
 * ⚠ The gate itself WAS spelled out here, and moved to `service-shared.ts` on
 * 2026-09-06 as the ninth copy of one idiom. The ruling above is unchanged; only
 * the `if` is shared now, and the action noun still comes from this file.
 */
const ARTIFACT_WRITE_ACTION = "change artifacts in this channel";

/**
 * CREATE — fold a set of messages into a new card.
 *
 * ⚠ **IDEMPOTENT ON `clientMsgId` FIRST, BEFORE ANYTHING IS WRITTEN**, and the
 * probe is AUTHOR-SCOPED (`repository-artifacts.ts › findOwnArtifactByClientId`
 * documents the vulnerability that shape closes). A retry converges on the
 * caller's own first artifact and re-reports what it folded, rather than making
 * a second card over messages the first one already took — which is the exact
 * failure design §5 asks this key to prevent, "and then half the run is in each".
 *
 * ⚠ ON CONVERGENCE IT FOLDS NOTHING MORE. The first call's fold is the answer;
 * re-running the stamp would let a retry quietly absorb messages that arrived
 * in between.
 */
export async function createArtifact(
  ctx: ChannelContext,
  ref: string,
  input: Extract<ArtifactActionInput, { action: "create" }>,
  authorAgentId: string | null = null
): Promise<ArtifactWriteResult> {
  const { channel } = await requireMemberChannel(ctx, ref, ARTIFACT_WRITE_ACTION);
  const requested = [...new Set(input.messages)].sort((a, b) => a - b);

  if (input.clientMsgId) {
    const existing = await repoArtifacts.findOwnArtifactByClientId(
      channel.id,
      ctx.userId,
      input.clientMsgId
    );
    if (existing) {
      // ⚠ **BOUNDED READ, SO THE CLIP HAS TO RIDE OUT WITH IT** (2026-09-06).
      // `memberSeqs` stops at `ARTIFACT_MEMBER_LIMIT`, so a retry converging on
      // an artifact of 200+ messages used to answer a short `folded` with
      // nothing saying it was short — the exact failure `readArtifact` spends a
      // whole field avoiding, on the one path where the answer is also the
      // caller's proof of what its first call boxed.
      const members = await memberSeqs(channel.id, existing.id);
      return {
        artifact: mapArtifactRow(existing),
        requested,
        // ⚠ **THE ARTIFACT'S MEMBERS NOW** — re-derived from the column rather
        // than remembered, because the column is the only record of membership
        // there is. ⚠ NOT "what the first call folded", which is what this
        // comment used to claim: membership moves under `add`, `remove` and
        // `dissolve`, so a retry landing after any of those honestly reports a
        // different set than the first call put in. The idempotency promise is
        // "your first artifact, and what it holds now" — never a second card
        // over messages the first one already took.
        //
        // ⚠ **A RETRY AFTER A DISSOLVE CONVERGES ON THE RETIRED CARD AND
        // REPORTS `folded: []`, AND THAT IS CORRECT** (ruled 2026-09-06, review
        // pass 2). `findOwnArtifactByClientId` does not filter `dissolved_at`
        // ON PURPOSE: dissolve is non-destructive and the card still resolves,
        // so the honest answer to "what does your artifact hold" is nothing.
        // Filtering the probe instead would mint a SECOND card under a key that
        // already has one, which is the failure the key exists to prevent.
        folded: members.seqs,
        truncated: members.truncated,
      };
    }
  }

  const row = await repoArtifacts.insertArtifact({
    channel_id: channel.id,
    workspace_id: channel.workspace_id,
    name: input.name,
    summary: input.summary ?? "",
    created_by: ctx.userId,
    created_by_agent: authorAgentId,
    client_msg_id: input.clientMsgId ?? null,
  });
  const folded = await repoArtifacts.foldMessagesIntoArtifact(
    channel.id,
    row.id,
    requested
  );
  return {
    artifact: mapArtifactRow(row),
    requested,
    folded: folded.sort((a, b) => a - b),
    // ⚠ A FRESH FOLD CANNOT CLIP: `folded` is what one UPDATE matched among the
    // seqs this call named, and nothing here reads `ARTIFACT_MEMBER_LIMIT`.
    truncated: false,
  };
}

/**
 * The member seqs of one artifact, in order — AND WHETHER THE READ CLIPPED.
 *
 * ⚠ **THE FLAG IS RETURNED WITH THE ROWS, NOT LEFT FOR THE CALLER TO REDERIVE**,
 * because the ceiling is the repository's and only this function sees the row
 * count it was applied to. `readArtifact` states the same rule against the same
 * constant; two readers, one bound.
 */
async function memberSeqs(
  channelId: string,
  artifactId: string
): Promise<{ seqs: number[]; truncated: boolean }> {
  const rows = await repoArtifacts.listMessagesByArtifact(channelId, artifactId);
  return {
    seqs: rows.map((r) => Number(r.seq)),
    truncated: rows.length >= repoArtifacts.ARTIFACT_MEMBER_LIMIT,
  };
}

/**
 * Resolve an artifact inside a channel the caller may WRITE to, refusing on a
 * dissolved one.
 *
 * ⚠ **A DISSOLVED ARTIFACT IS NOT A TARGET.** It still RESOLVES (that is why
 * dissolve stamps rather than deletes — an old citation gets an honest answer),
 * but adding a message to a retired card would silently re-open it, and the
 * design has no re-open. The refusal names the state rather than pretending the
 * id is unknown, because the caller can plainly see the card.
 */
async function loadWritableArtifact(ctx: ChannelContext, ref: string, artifactId: string) {
  const { channel } = await requireMemberChannel(ctx, ref, ARTIFACT_WRITE_ACTION);
  const row = await repoArtifacts.findArtifactByChannelAndId(channel.id, artifactId);
  if (!row) throw new ArtifactNotFoundError(artifactId);
  if (row.dissolved_at !== null) {
    throw new ChannelForbiddenError("change a dissolved artifact");
  }
  return { channel, row };
}

/**
 * ADD one message. ⚠ Free over messages the caller can read (decision 1), so
 * membership is the only gate — the same authority a create has, because `add`
 * IS a create over one more row.
 *
 * ⚠ A message already in ANOTHER artifact does not move: the fold statement
 * requires `artifact_id IS NULL`, so `folded` comes back empty and the caller is
 * told. That is "one artifact per message" holding as a schema property rather
 * than as a check something could forget.
 */
export async function addToArtifact(
  ctx: ChannelContext,
  ref: string,
  input: Extract<ArtifactActionInput, { action: "add" }>
): Promise<ArtifactWriteResult> {
  const { channel, row } = await loadWritableArtifact(ctx, ref, input.artifact);
  const folded = await repoArtifacts.foldMessagesIntoArtifact(channel.id, row.id, [
    input.message,
  ]);
  // ⚠ SORTED LIKE `create`'s (2026-09-06). One statement returns at most one seq
  // here, so the sort is a no-op TODAY — it is written anyway because the shape
  // is the contract: every `folded` this file answers is ascending, and a caller
  // that may not assume it for one action cannot assume it for any.
  return {
    artifact: mapArtifactRow(row),
    requested: [input.message],
    folded: folded.sort((a, b) => a - b),
    truncated: false,
  };
}

/**
 * REMOVE one message — the per-message UN-BOX.
 *
 * 🔒 **THE ONE ASYMMETRIC AUTHORITY IN THE DESIGN** (decision 1): un-boxing is
 * free for the AUTHOR of the folded message and for the artifact's CREATOR, and
 * needs no consent from either side. The justification is that folding is
 * non-destructive and reversible, so a consent gate buys little and serializes
 * an agent's wrap-up behind a human — but the author's own escape hatch is what
 * makes "an agent may fold a peer's message" acceptable at all. ⚠ Do not widen
 * this to any member without re-opening the ruling.
 */
export async function removeFromArtifact(
  ctx: ChannelContext,
  ref: string,
  input: Extract<ArtifactActionInput, { action: "remove" }>
): Promise<ArtifactWriteResult> {
  const { channel, row } = await loadWritableArtifact(ctx, ref, input.artifact);
  if (row.created_by !== ctx.userId) {
    // ⚠ Read the MESSAGE to answer "am I its author" — the artifact row cannot
    // answer it, and guessing from membership would hand every member the
    // author's power.
    const members = await repoArtifacts.listMessagesByArtifact(channel.id, row.id);
    const target = members.find((m) => Number(m.seq) === input.message);
    if (!target || target.author_user_id !== ctx.userId) {
      throw new ChannelForbiddenError("un-box a message you did not write");
    }
  }
  const folded = await repoArtifacts.unfoldMessage(channel.id, row.id, input.message);
  return {
    artifact: mapArtifactRow(row),
    requested: [input.message],
    folded: folded.sort((a, b) => a - b),
    truncated: false,
  };
}

/**
 * DISSOLVE — clear every member and retire the card. Nothing is deleted.
 *
 * ⚠ **CREATOR ONLY, AND THIS IS A JUDGMENT CALL I AM NAMING RATHER THAN
 * BURYING.** Decision 1 rules the per-message un-box for the message's author
 * and the artifact's creator, and says nothing about dissolve. Reading the
 * author's arm across to dissolve would let one member's single folded message
 * un-box everybody else's too, which is a power over other people's view that
 * the ruling never granted. Creator-only is the narrow reading; widening it is
 * one predicate, and it should be Samuel's word, not mine.
 */
export async function dissolveArtifact(
  ctx: ChannelContext,
  ref: string,
  input: Extract<ArtifactActionInput, { action: "dissolve" }>
): Promise<ArtifactWriteResult> {
  const { channel, row } = await loadWritableArtifact(ctx, ref, input.artifact);
  if (row.created_by !== ctx.userId) {
    throw new ChannelForbiddenError("dissolve an artifact you did not create");
  }
  // ⚠ **`requested` IS THE MEMBERSHIP READ BEFORE THE UN-FOLD, NOT THE UN-FOLD'S
  // OWN ANSWER** (2026-09-06). It was `requested: released, folded: released` —
  // the same array twice — which made the interface's contract at :60-65
  // ("`folded` MAY BE SHORTER THAN `requested`, AND SAYING SO IS THE CONTRACT")
  // vacuous on this action: the two could not differ, so a caller comparing them
  // learned nothing. Reading the members FIRST is the smallest honest fix — it
  // costs one bounded read and makes the comparison mean here what it means
  // everywhere else: what this call SET OUT to release, against what it did. A
  // concurrent `remove` landing in between is exactly the case that separates
  // them. ⚠ The alternative, `requested: []`, is cheaper and also true (dissolve
  // names no seqs) but would leave `folded` LONGER than `requested`, inverting
  // the one comparison the field exists for.
  const before = await memberSeqs(channel.id, row.id);
  // ⚠ ORDER MATTERS: un-fold FIRST, retire SECOND. A crash between them leaves
  // an un-folded set and a live card — visibly empty, and fixable by dissolving
  // again. The reverse order would leave messages folded into a retired card,
  // which nothing can un-box because `loadWritableArtifact` refuses it.
  const released = await repoArtifacts.unfoldAllForArtifact(channel.id, row.id);
  const retired = await repoArtifacts.markArtifactDissolved(channel.id, row.id);
  return {
    artifact: mapArtifactRow(retired ?? row),
    requested: before.seqs,
    folded: released.sort((a, b) => a - b),
    // ⚠ THE CLIP IS THE `requested` READ'S, and it rides out for the reason the
    // field exists: past the ceiling, `requested` is short while `released` is
    // whole, so the two disagreeing is the BOUND rather than a lost message.
    truncated: before.truncated,
  };
}

/**
 * OPEN ONE ARTIFACT — `op=read, artifact=<id>`: the members verbatim, in seq
 * order, unfolded, with their own seqs visible (design §4).
 *
 * ⚠ **READING BELONGS TO `read`, NOT TO ITS OWN OP** — the design is explicit,
 * and it is why this returns messages rather than a new shape.
 * ⚠ VISIBILITY, NOT MEMBERSHIP: a public channel's reader may open a card they
 * can already read the contents of.
 * ⚠ `truncated` is not decoration (INVARIANTS §9): at the ceiling is
 * indistinguishable from over it, and a clipped list that renders like an
 * exhausted one is the bug.
 */
export async function readArtifact(
  ctx: ChannelContext,
  ref: string,
  artifactId: string
): Promise<{
  artifact: ChannelArtifact;
  messages: ChannelMessage[];
  truncated: boolean;
}> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const row = await repoArtifacts.findArtifactByChannelAndId(channel.id, artifactId);
  if (!row) throw new ArtifactNotFoundError(artifactId);
  const rows = await repoArtifacts.listMessagesByArtifact(channel.id, row.id);
  return {
    artifact: mapArtifactRow(row),
    messages: await hydrateMessages(rows, ctx.workspaceId),
    truncated: rows.length >= repoArtifacts.ARTIFACT_MEMBER_LIMIT,
  };
}

/**
 * 🔒 **DOES THIS READ NAME MESSAGES?** — the addressing PIN of design §3, and
 * the one rule that keeps every citation in a room from degrading into "it is
 * in that box somewhere".
 *
 * "Folding may only affect the DEFAULT page. A read that NAMES a message — an
 * explicit seq, or a range containing it — returns the message itself, folded or
 * not." Spelled against the query shapes this codebase actually has:
 *
 *   - **`thread` set** → a thread-scoped read is already a named subset, and
 *     the design folds MAIN-ROOM runs. Never folds.
 *   - **`since` AND `before` together** → a BOUNDED WINDOW, which is exactly
 *     the "range containing it" the pin describes: a caller resolving `#1119`
 *     asks for the window around it and must get the message. Never folds.
 *   - **`since` alone / `before` alone / neither** → a CURSOR or the newest
 *     page. That is the default read, and it folds.
 *
 * ⚠ A cursor is NOT a range naming a message: `since` names where to start, not
 * what to return, and treating it as naming would mean nothing ever folds —
 * the incremental read IS the default read for every agent on the wire.
 *
 * ⚠ **CHEAP TO STATE TODAY, EXPENSIVE TO RETROFIT** once a caller assumes
 * otherwise, which is why the design pinned it before any code existed.
 */
export function readNamesMessages(query: {
  since?: number;
  before?: number;
  thread?: string;
}): boolean {
  if (query.thread !== undefined) return true;
  return query.since !== undefined && query.before !== undefined;
}

/**
 * THE FOLD — a page of messages becomes a page of ENTRIES.
 *
 * ⚠ **PURE, AND THAT IS DELIBERATE**: it takes the page and the artifact facts
 * already fetched, so the rule is testable without a database and cannot drift
 * into doing its own reads.
 *
 * ⚠ **THE CARD RENDERS AT THE POSITION OF ITS LOWEST MEMBER SEQ ON THIS PAGE**,
 * and every other member of that artifact on the page disappears into it —
 * ONE entry per artifact per page, no matter how many of its members are here.
 *
 * ⚠ **NON-MEMBERS INSIDE THE SPAN RENDER NORMALLY** (decision 5, contiguity).
 * An artifact holds an arbitrary SET, so a card can appear to interrupt a
 * conversation it does not contain all of. The alternative — silently boxing a
 * bystander's message to keep a range tidy — is worse, and it would drag the
 * authority question into every create.
 *
 * ⚠ **A MEMBER WHOSE ARTIFACT WE COULD NOT LOAD RENDERS AS A MESSAGE.** Missing
 * facts must degrade to "unfolded", never to "dropped": a transcript that
 * silently loses rows because a card lookup failed is data loss on a read path.
 */
export function foldEntries(
  messages: ChannelMessage[],
  artifacts: ReadonlyMap<string, ChannelArtifact>,
  spans: ReadonlyMap<string, repoArtifacts.ArtifactSpan>
): ChannelReadEntry[] {
  const out: ChannelReadEntry[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const id = message.artifactId ?? null;
    const artifact = id ? artifacts.get(id) : undefined;
    const span = id ? spans.get(id) : undefined;
    if (!id || !artifact || !span) {
      out.push({ type: "message", message });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const folded: ChannelFoldedArtifact = {
      artifact,
      count: span.count,
      firstSeq: span.firstSeq,
      lastSeq: span.lastSeq,
    };
    out.push({ type: "artifact", folded });
  }
  return out;
}

/**
 * The whole read side in one call: fold a page unless the query NAMES messages.
 *
 * ⚠ **TWO READS, BOTH BOUNDED BY THE PAGE**, and neither runs when the page has
 * no folded rows — an ordinary transcript pays nothing for this feature.
 */
export async function foldPage(
  channelId: string,
  messages: ChannelMessage[],
  query: { since?: number; before?: number; thread?: string }
): Promise<ChannelReadEntry[]> {
  // ⚠ A THUNK, not a computed array: both guards answer with the same
  // un-folded page, but the folding path must not pay to build one it discards
  // — "an ordinary transcript pays nothing for this feature" is the claim above.
  const unfolded = () =>
    messages.map((message) => ({ type: "message", message }) as const);
  if (readNamesMessages(query)) {
    return unfolded();
  }
  const ids = [
    ...new Set(
      messages
        .map((m) => m.artifactId ?? null)
        .filter((id): id is string => id !== null)
    ),
  ];
  if (ids.length === 0) {
    return unfolded();
  }
  const [rows, spans] = await Promise.all([
    repoArtifacts.listArtifactsByIds(channelId, ids),
    repoArtifacts.artifactSpans(channelId, ids),
  ]);
  const artifacts = new Map(rows.map((r) => [r.id, mapArtifactRow(r)]));
  return foldEntries(messages, artifacts, spans);
}
